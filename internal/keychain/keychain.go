// Package keychain stores SSH passwords in the macOS Keychain via the
// system `security` tool (no cgo needed). On other platforms every call
// simply fails, which callers treat as "not stored".
package keychain

import (
	"bytes"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
)

const service = "MutagenUI-SSH"

// Supported reports whether credential storage is available on this platform.
// Windows/Linux 上返回 false：不提供保存选项，每次通过弹窗输入密码。
func Supported() bool {
	return runtime.GOOS == "darwin"
}

// Get returns the stored password for an account like "user@host".
func Get(account string) (string, error) {
	out, err := run("find-generic-password", "-s", service, "-a", account, "-w")
	if err != nil {
		return "", err
	}
	return strings.TrimRight(out, "\n"), nil
}

// Set stores or updates the password for an account.
func Set(account, password string) error {
	// -U updates an existing item instead of failing on duplicates.
	_, err := run("add-generic-password", "-U", "-s", service, "-a", account, "-w", password)
	return err
}

// Delete removes the stored password for an account.
func Delete(account string) error {
	_, err := run("delete-generic-password", "-s", service, "-a", account)
	return err
}

func run(args ...string) (string, error) {
	cmd := exec.Command("security", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("keychain: %s", msg)
	}
	return stdout.String(), nil
}
