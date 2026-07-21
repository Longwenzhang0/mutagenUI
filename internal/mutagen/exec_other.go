//go:build !windows

package mutagen

import "os/exec"

func hideConsole(*exec.Cmd) {}
