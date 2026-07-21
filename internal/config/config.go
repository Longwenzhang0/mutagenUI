// Package config persists app settings and session presets to the user's
// config directory (~/Library/Application Support/MutagenUI on macOS).
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Preset is a reusable session template so common ignore rules and remote
// hosts don't have to be retyped for every new session.
type Preset struct {
	Name      string   `json:"name"`
	Alpha     string   `json:"alpha"`
	Beta      string   `json:"beta"`
	Mode      string   `json:"mode"`
	IgnoreVCS bool     `json:"ignoreVCS"`
	Ignores   []string `json:"ignores"`
}

// Group is a user-defined bucket of sessions in the sidebar. Sessions are
// referenced by name (falling back to identifier for unnamed ones) so
// membership survives terminate-and-recreate.
type Group struct {
	Name      string   `json:"name"`
	Collapsed bool     `json:"collapsed"`
	Sessions  []string `json:"sessions"`
}

// Layout captures sidebar organization: manual ordering, grouping, and the
// active sort mode ("manual" | "name" | "status").
type Layout struct {
	SortMode  string   `json:"sortMode"`
	Groups    []Group  `json:"groups"`
	Ungrouped []string `json:"ungrouped"`
}

type Config struct {
	MutagenPath string   `json:"mutagenPath"`
	Presets     []Preset `json:"presets"`
	Layout      Layout   `json:"layout"`
}

func configFile() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "MutagenUI", "config.json"), nil
}

// Load reads the config; a missing file yields a zero-value config.
func Load() (Config, error) {
	var cfg Config
	path, err := configFile()
	if err != nil {
		return cfg, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return cfg, err
	}
	err = json.Unmarshal(data, &cfg)
	return cfg, err
}

func Save(cfg Config) error {
	path, err := configFile()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}
