//go:build !windows

package mutagen

import (
	"os"
	"os/exec"

	"github.com/creack/pty"
)

type unixPTY struct {
	cmd *exec.Cmd
	f   *os.File
}

func startPTY(bin string, args []string) (ptyHandle, error) {
	cmd := exec.Command(bin, args...)
	f, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}
	return &unixPTY{cmd: cmd, f: f}, nil
}

func (p *unixPTY) Read(b []byte) (int, error)  { return p.f.Read(b) }
func (p *unixPTY) Write(b []byte) (int, error) { return p.f.Write(b) }
func (p *unixPTY) Kill() error                 { return p.cmd.Process.Kill() }
func (p *unixPTY) Wait() error                 { return p.cmd.Wait() }
func (p *unixPTY) Close() error                { return p.f.Close() }
