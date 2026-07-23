package mutagen

import (
	"fmt"
	"io"
	"regexp"
	"strings"
	"sync"
	"time"
)

// DebugLog, when set, receives a trace of every interactive run: raw PTY
// output (escapes visible), prompt detection decisions, and exit status.
// Prompt answers are never written to it.
var DebugLog io.Writer

var debugMu sync.Mutex

func dbg(format string, args ...any) {
	if DebugLog == nil {
		return
	}
	debugMu.Lock()
	defer debugMu.Unlock()
	fmt.Fprintf(DebugLog, time.Now().Format("15:04:05.000 ")+format+"\n", args...)
}

// PromptFunc is called when mutagen asks for interactive input (SSH password,
// key passphrase, host-key confirmation). masked indicates the answer should
// be hidden in the UI. attempt counts masked prompts within one command run:
// attempt 1 may be answered from stored credentials, attempt >= 2 means the
// previous answer was rejected and a human should decide. The second return
// value is false when the user cancels.
type PromptFunc func(prompt string, masked bool, attempt int) (string, bool)

// ptyHandle abstracts a process attached to a pseudo-terminal. Implemented by
// creack/pty on Unix and ConPTY on Windows (see pty_unix.go / pty_windows.go).
type ptyHandle interface {
	io.ReadWriter
	Kill() error
	Wait() error
	Close() error
}

var (
	// e.g. "user@1.2.3.4's password:" / "Enter passphrase for key ...:"
	passwordRe = regexp.MustCompile(`(?i)(password|passphrase)[^:\n]*:\s*$`)
	// e.g. "Are you sure you want to continue connecting (yes/no/[fingerprint])?"
	// and ssh's retry form "Please type 'yes', 'no' or the fingerprint:"
	yesNoRe = regexp.MustCompile(`\(yes/no(/\[fingerprint\])?\)\??\s*$|(?i:type 'yes'.*:\s*$)`)
	// ssh 拒绝上一次密码后的提示，如 "Permission denied, please try again." /
	// "Bad passphrase, try again"。据此区分"密码错了重问"和"新连接首次询问"。
	rejectRe = regexp.MustCompile(`(?i)permission denied|try again|authentication failed`)
)

// runInteractive executes mutagen under a pseudo-terminal so that its SSH
// prompts appear on the output stream, where they are matched and routed to
// the Prompter instead of a (nonexistent) controlling terminal.
func (c *Client) runInteractive(args ...string) (string, error) {
	if c.Prompter == nil {
		return c.run(args...)
	}
	bin, err := c.ResolveBinary()
	if err != nil {
		return "", err
	}
	dbg("start: %s %v", bin, args)
	p, err := startPTY(bin, args)
	if err != nil {
		dbg("startPTY failed: %v", err)
		return "", fmt.Errorf("无法启动伪终端: %w", err)
	}
	defer p.Close()

	var all strings.Builder
	var line strings.Builder
	buf := make([]byte, 4096)
	maskedAttempts := 0
	// mutagen 一次命令会开多条 SSH 连接（连接代理/探测/拷贝/启动），每条都问
	// 一遍密码。缓存本次运行内首个成功输入的答案，相同提示自动复用；只有
	// 输出里出现 ssh 的拒绝提示（rejectRe）才重新询问用户。
	var cachedPrompt, cachedAnswer string
	var sinceAnswer strings.Builder
	for {
		n, rerr := p.Read(buf)
		if n > 0 {
			chunk := string(buf[:n])
			dbg("out: %q", chunk)
			all.WriteString(chunk)
			sinceAnswer.WriteString(chunk)
			for _, r := range chunk {
				if r == '\n' || r == '\r' {
					line.Reset()
				} else {
					line.WriteRune(r)
				}
			}
			cur := line.String()
			masked, isPrompt := classifyPrompt(cur)
			if isPrompt {
				promptText := strings.TrimSpace(stripANSI(cur))
				rejected := answerRejected(stripANSI(sinceAnswer.String()))
				sinceAnswer.Reset()
				answer := ""
				if masked && !rejected && cachedAnswer != "" && promptText == cachedPrompt {
					dbg("prompt reusing cached answer: %q", promptText)
					answer = cachedAnswer
				} else {
					attempt := 1
					if masked {
						if rejected {
							cachedAnswer = ""
						}
						maskedAttempts++
						attempt = maskedAttempts
					}
					dbg("prompt detected (masked=%v attempt=%d rejected=%v): %q", masked, attempt, rejected, promptText)
					ans, ok := c.Prompter(promptText, masked, attempt)
					if !ok {
						dbg("prompt cancelled by user")
						_ = p.Kill()
						_ = p.Wait()
						return "", fmt.Errorf("已取消")
					}
					dbg("prompt answered (len=%d)", len(ans))
					answer = ans
					if masked {
						cachedPrompt, cachedAnswer = promptText, answer
					}
				}
				if _, werr := p.Write([]byte(answer + "\n")); werr != nil {
					dbg("write answer failed: %v", werr)
					break
				}
				line.Reset()
			}
		}
		// pty read ends with EOF on macOS (EIO on Linux, closed pipe on
		// Windows) once the child exits.
		if rerr != nil {
			dbg("read ended: %v", rerr)
			break
		}
	}
	err = p.Wait()
	dbg("exit: %v", err)
	out := all.String()
	if err != nil {
		return "", fmt.Errorf("%s", tailLines(stripANSI(out), 6))
	}
	return out, nil
}

// answerRejected reports whether the output since the last answered prompt
// indicates ssh rejected that answer (as opposed to a new connection asking
// for the first time).
func answerRejected(since string) bool {
	return rejectRe.MatchString(since)
}

func classifyPrompt(line string) (masked, isPrompt bool) {
	line = stripANSI(line)
	if passwordRe.MatchString(line) {
		return true, true
	}
	if yesNoRe.MatchString(line) {
		return false, true
	}
	return false, false
}

// ansiRe matches ANSI escape sequences, which Windows ConPTY injects into the
// output stream even for plain text.
var ansiRe = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07`)

func stripANSI(s string) string {
	return ansiRe.ReplaceAllString(s, "")
}

func tailLines(s string, n int) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	kept := make([]string, 0, n)
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l != "" {
			kept = append(kept, l)
		}
	}
	if len(kept) > n {
		kept = kept[len(kept)-n:]
	}
	if len(kept) == 0 {
		return "命令执行失败"
	}
	return strings.Join(kept, "\n")
}
