// Package bundled ships the mutagen CLI inside the app binary so users don't
// need to install mutagen themselves. The binary and its agents archive
// (which mutagen requires next to its executable) are extracted on first run.
package bundled

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// Version is the bundled mutagen release; the extraction directory is
// versioned so app upgrades re-extract automatically.
const Version = "0.18.1"

// Extract writes the bundled mutagen binary and agents archive to a versioned
// directory under the user config dir and returns the binary path. It returns
// "" (no error) when nothing is bundled for this platform.
func Extract() (string, error) {
	if len(mutagenBinary) == 0 || len(agentsArchive) == 0 {
		return "", nil
	}
	cfgDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	binName := "mutagen"
	if runtime.GOOS == "windows" {
		binName = "mutagen.exe"
	}
	dir := filepath.Join(cfgDir, "MutagenUI", "bin", Version)
	binPath := filepath.Join(dir, binName)
	agentsPath := filepath.Join(dir, "mutagen-agents.tar.gz")

	if isFile(binPath) && isFile(agentsPath) {
		return binPath, nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	if err := atomicWrite(binPath, mutagenBinary, 0o755); err != nil {
		return "", fmt.Errorf("解压内置 mutagen 失败: %w", err)
	}
	if err := atomicWrite(agentsPath, agentsArchive, 0o644); err != nil {
		return "", fmt.Errorf("解压内置 mutagen agents 失败: %w", err)
	}
	return binPath, nil
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular() && info.Size() > 0
}

// atomicWrite avoids a truncated file (e.g. app quit mid-extraction) being
// mistaken for a valid binary on the next launch.
func atomicWrite(path string, data []byte, perm os.FileMode) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, perm); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
