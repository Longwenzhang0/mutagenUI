//go:build windows

package mutagen

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/UserExistsError/conpty"
	"golang.org/x/sys/windows"
)

// winPTY drives mutagen through ConPTY (Windows 10 1809+ / Windows 11).
//
// 关键差异：子进程退出后 ConPTY 的输出管道不会自动关闭（要等
// ClosePseudoConsole），Read 会永远阻塞。所以这里用一个 goroutine 等待
// 进程退出，然后主动 Close 解除 Read 阻塞，否则命令成功了 UI 也会卡住。
type winPTY struct {
	cp        *conpty.ConPty
	done      chan struct{}
	exitCode  uint32
	waitErr   error
	closeOnce sync.Once
	closeErr  error
}

// doClose closes the pseudo console exactly once — Kill、defer Close 和退出
// goroutine 都会调它，而对已关闭的伪控制台重复 ClosePseudoConsole 会崩溃。
func (p *winPTY) doClose() error {
	p.closeOnce.Do(func() { p.closeErr = p.cp.Close() })
	return p.closeErr
}

func startPTY(bin string, args []string) (ptyHandle, error) {
	parts := []string{windows.EscapeArg(bin)}
	for _, a := range args {
		parts = append(parts, windows.EscapeArg(a))
	}
	cp, err := conpty.Start(strings.Join(parts, " "))
	if err != nil {
		return nil, err
	}
	p := &winPTY{cp: cp, done: make(chan struct{})}
	go func() {
		p.exitCode, p.waitErr = cp.Wait(context.Background())
		close(p.done)
		// 稍等一下让最后一段输出被读走，再关闭伪控制台解除 Read 阻塞
		time.Sleep(150 * time.Millisecond)
		_ = p.doClose()
	}()
	return p, nil
}

func (p *winPTY) Read(b []byte) (int, error)  { return p.cp.Read(b) }
func (p *winPTY) Write(b []byte) (int, error) { return p.cp.Write(b) }

// Kill closes the pseudo console, which terminates the attached process.
func (p *winPTY) Kill() error { return p.doClose() }

func (p *winPTY) Wait() error {
	<-p.done
	if p.waitErr != nil {
		return p.waitErr
	}
	if p.exitCode != 0 {
		return fmt.Errorf("exit status %d", p.exitCode)
	}
	return nil
}

func (p *winPTY) Close() error { return p.doClose() }
