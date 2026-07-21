//go:build windows

package mutagen

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

// hideConsole prevents the console window flash that Windows shows whenever
// a GUI app spawns a console subprocess — without this, the 2-second status
// polling blinks a black panel on every tick.
func hideConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
}
