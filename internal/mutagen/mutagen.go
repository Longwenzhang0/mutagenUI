// Package mutagen wraps the mutagen CLI to manage synchronization sessions.
package mutagen

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// Client invokes the mutagen binary. BinaryPath is a user-configured
// override; BundledPath points at the binary extracted from the app itself.
// PATH lookup is the last resort because a .app launched from Finder does not
// inherit the shell PATH.
type Client struct {
	BinaryPath  string
	BundledPath string
	// Prompter handles interactive SSH prompts (password / host key) for
	// commands that establish connections; nil falls back to non-interactive
	// execution, where such prompts fail.
	Prompter PromptFunc
}

var commonPaths = []string{
	"/opt/homebrew/bin/mutagen",
	"/usr/local/bin/mutagen",
	"/usr/bin/mutagen",
}

// ResolveBinary returns the mutagen binary to use, or an error if none is found.
func (c *Client) ResolveBinary() (string, error) {
	if c.BinaryPath != "" {
		if _, err := os.Stat(c.BinaryPath); err != nil {
			return "", fmt.Errorf("配置的 mutagen 路径不可用: %s", c.BinaryPath)
		}
		return c.BinaryPath, nil
	}
	if c.BundledPath != "" {
		if _, err := os.Stat(c.BundledPath); err == nil {
			return c.BundledPath, nil
		}
	}
	if p, err := exec.LookPath("mutagen"); err == nil {
		return p, nil
	}
	for _, p := range commonPaths {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("未找到 mutagen：内置副本解压失败且系统未安装。可在设置中手动指定二进制路径")
}

func (c *Client) run(args ...string) (string, error) {
	bin, err := c.ResolveBinary()
	if err != nil {
		return "", err
	}
	cmd := exec.Command(bin, args...)
	hideConsole(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(stdout.String())
		}
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("%s", msg)
	}
	return stdout.String(), nil
}

// Version returns the mutagen version string.
func (c *Client) Version() (string, error) {
	out, err := c.run("version")
	return strings.TrimSpace(out), err
}

// EnsureDaemon starts the mutagen daemon if it is not already running.
// Errors are non-fatal because most commands auto-start the daemon anyway.
func (c *Client) EnsureDaemon() {
	_, _ = c.run("daemon", "start")
}

// Session is a normalized view of a mutagen session. Raw carries the full
// template output so the UI can always show the ground truth regardless of
// mutagen version differences in field naming.
type Session struct {
	Identifier     string         `json:"identifier"`
	Name           string         `json:"name"`
	Paused         bool           `json:"paused"`
	Status         string         `json:"status"`
	AlphaURL       string         `json:"alphaUrl"`
	BetaURL        string         `json:"betaUrl"`
	AlphaConnected bool           `json:"alphaConnected"`
	BetaConnected  bool           `json:"betaConnected"`
	AlphaPath      string         `json:"alphaPath"`
	BetaPath       string         `json:"betaPath"`
	AlphaLocal     bool           `json:"alphaLocal"`
	Mode           string         `json:"mode"`
	IgnoreVCS      bool           `json:"ignoreVCS"`
	Ignores        []string       `json:"ignores"`
	ConflictCount  int            `json:"conflictCount"`
	ProblemCount   int            `json:"problemCount"`
	Problems       []Problem      `json:"problems"`
	Conflicts      []string       `json:"conflicts"`
	LastError      string         `json:"lastError"`
	Raw            map[string]any `json:"raw"`
}

// Problem is a flattened scan/transition problem from either endpoint.
type Problem struct {
	Side  string `json:"side"` // "alpha" (本地) or "beta" (远程)
	Kind  string `json:"kind"` // "scan" or "transition"
	Path  string `json:"path"`
	Error string `json:"error"`
}

// List returns all synchronization sessions. Requires mutagen >= 0.16
// (for --template support).
func (c *Client) List() ([]Session, error) {
	out, err := c.run("sync", "list", "--template", "{{json .}}")
	if err != nil {
		return nil, err
	}
	out = strings.TrimSpace(out)
	if out == "" || out == "null" {
		return []Session{}, nil
	}
	var raw []map[string]any
	if err := json.Unmarshal([]byte(out), &raw); err != nil {
		return nil, fmt.Errorf("解析 mutagen 输出失败（需要 mutagen >= 0.16）: %v", err)
	}
	sessions := make([]Session, 0, len(raw))
	for _, m := range raw {
		sessions = append(sessions, normalize(m))
	}
	return sessions, nil
}

func normalize(m map[string]any) Session {
	s := Session{
		Identifier: getString(m, "identifier"),
		Name:       getString(m, "name"),
		Paused:     getBool(m, "paused"),
		Status:     getString(m, "status"),
		LastError:  getString(m, "lastError"),
		Raw:        m,
	}
	if s.Status == "" {
		s.Status = getString(m, "state")
	}
	if alpha, ok := m["alpha"].(map[string]any); ok {
		s.AlphaURL = formatEndpoint(alpha)
		s.AlphaConnected = getBool(alpha, "connected")
		s.AlphaPath = getString(alpha, "path")
		s.AlphaLocal = getString(alpha, "host") == ""
	}
	if beta, ok := m["beta"].(map[string]any); ok {
		s.BetaURL = formatEndpoint(beta)
		s.BetaConnected = getBool(beta, "connected")
		s.BetaPath = getString(beta, "path")
	}
	extractConfig(m, &s)
	s.Problems = collectProblems(m)
	s.Conflicts = collectConflicts(m)
	// Excluded counts appear when mutagen truncates long problem/conflict
	// lists, so the totals can exceed what is listed.
	s.ProblemCount = len(s.Problems) +
		getInt(m, "excludedScanProblems") + getInt(m, "excludedTransitionProblems")
	s.ConflictCount = len(s.Conflicts) + getInt(m, "excludedConflicts")
	return s
}

// extractConfig pulls the session's sync mode and ignore configuration out of
// the template output so a running session can be saved as a preset. Field
// placement varies across mutagen versions, so both the top level and a
// nested "configuration" object are consulted.
func extractConfig(m map[string]any, s *Session) {
	sources := []map[string]any{m}
	if c, ok := m["configuration"].(map[string]any); ok {
		sources = append([]map[string]any{c}, sources...)
	}
	for _, src := range sources {
		if s.Mode == "" {
			if v := getString(src, "mode"); v != "" {
				s.Mode = v
			} else if v := getString(src, "syncMode"); v != "" {
				s.Mode = v
			}
		}
		if ig, ok := src["ignore"].(map[string]any); ok {
			if getBool(ig, "vcs") {
				s.IgnoreVCS = true
			}
			if len(s.Ignores) == 0 {
				if paths, ok := ig["paths"].([]any); ok {
					for _, p := range paths {
						if str, ok := p.(string); ok {
							s.Ignores = append(s.Ignores, str)
						}
					}
				}
			}
		}
		// Older flat layout.
		if getBool(src, "ignoreVCSMode") || getBool(src, "ignoreVCS") {
			s.IgnoreVCS = true
		}
		if len(s.Ignores) == 0 {
			if paths, ok := src["ignores"].([]any); ok {
				for _, p := range paths {
					if str, ok := p.(string); ok {
						s.Ignores = append(s.Ignores, str)
					}
				}
			}
		}
	}
}

func collectProblems(m map[string]any) []Problem {
	var problems []Problem
	appendSide := func(side, key string, state map[string]any, kind string) {
		if items, ok := state[key].([]any); ok {
			for _, it := range items {
				if p, ok := it.(map[string]any); ok {
					problems = append(problems, Problem{
						Side:  side,
						Kind:  kind,
						Path:  getString(p, "path"),
						Error: getString(p, "error"),
					})
				}
			}
		}
	}
	for _, name := range []string{"alpha", "beta", "alphaState", "betaState"} {
		side := "alpha"
		if strings.HasPrefix(name, "beta") {
			side = "beta"
		}
		if state, ok := m[name].(map[string]any); ok {
			appendSide(side, "scanProblems", state, "scan")
			appendSide(side, "transitionProblems", state, "transition")
		}
	}
	return problems
}

func collectConflicts(m map[string]any) []string {
	var roots []string
	if items, ok := m["conflicts"].([]any); ok {
		for _, it := range items {
			c, ok := it.(map[string]any)
			if !ok {
				continue
			}
			root := getString(c, "root")
			if root == "" {
				// Fall back to the first change path on either side.
				for _, key := range []string{"alphaChanges", "betaChanges"} {
					if changes, ok := c[key].([]any); ok && len(changes) > 0 {
						if ch, ok := changes[0].(map[string]any); ok {
							root = getString(ch, "path")
						}
					}
					if root != "" {
						break
					}
				}
			}
			if root == "" {
				root = "(未知路径)"
			}
			roots = append(roots, root)
		}
	}
	return roots
}

// formatEndpoint renders an endpoint object as a mutagen-style URL:
// [user@]host[:port]:path for SSH endpoints, bare path for local ones.
func formatEndpoint(e map[string]any) string {
	if u := getString(e, "url"); u != "" {
		return u
	}
	path := getString(e, "path")
	host := getString(e, "host")
	if host == "" {
		return path
	}
	var b strings.Builder
	if user := getString(e, "user"); user != "" {
		b.WriteString(user)
		b.WriteString("@")
	}
	b.WriteString(host)
	if port := getInt(e, "port"); port != 0 {
		fmt.Fprintf(&b, ":%d", port)
	}
	b.WriteString(":")
	b.WriteString(path)
	return b.String()
}

// CreateSpec describes a new synchronization session.
type CreateSpec struct {
	Name      string   `json:"name"`
	Alpha     string   `json:"alpha"`
	Beta      string   `json:"beta"`
	Mode      string   `json:"mode"`
	IgnoreVCS bool     `json:"ignoreVCS"`
	Ignores   []string `json:"ignores"`
}

// Create starts a new synchronization session.
func (c *Client) Create(spec CreateSpec) error {
	if spec.Alpha == "" || spec.Beta == "" {
		return fmt.Errorf("本地路径 (alpha) 和远程路径 (beta) 不能为空")
	}
	args := []string{"sync", "create"}
	if spec.Name != "" {
		args = append(args, "--name", spec.Name)
	}
	if spec.Mode != "" {
		args = append(args, "--sync-mode", spec.Mode)
	}
	if spec.IgnoreVCS {
		args = append(args, "--ignore-vcs")
	}
	for _, ig := range spec.Ignores {
		ig = strings.TrimSpace(ig)
		if ig != "" {
			args = append(args, "--ignore", ig)
		}
	}
	args = append(args, spec.Alpha, spec.Beta)
	_, err := c.runInteractive(args...)
	return err
}

// Pause pauses a session by name or identifier.
func (c *Client) Pause(name string) error {
	_, err := c.run("sync", "pause", name)
	return err
}

// Resume resumes a paused session. Reconnects SSH, so it may prompt.
func (c *Client) Resume(name string) error {
	_, err := c.runInteractive("sync", "resume", name)
	return err
}

// Flush forces an immediate synchronization cycle.
func (c *Client) Flush(name string) error {
	_, err := c.runInteractive("sync", "flush", name)
	return err
}

// Reset resets a session's history (useful after conflicts).
func (c *Client) Reset(name string) error {
	_, err := c.runInteractive("sync", "reset", name)
	return err
}

// Terminate permanently removes a session.
func (c *Client) Terminate(name string) error {
	_, err := c.run("sync", "terminate", name)
	return err
}

func getString(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func getBool(m map[string]any, key string) bool {
	if v, ok := m[key].(bool); ok {
		return v
	}
	return false
}

func getInt(m map[string]any, key string) int {
	if v, ok := m[key].(float64); ok {
		return int(v)
	}
	return 0
}

func arrayLen(m map[string]any, key string) int {
	if v, ok := m[key].([]any); ok {
		return len(v)
	}
	return 0
}
