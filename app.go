package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"mutagenui/internal/bundled"
	"mutagenui/internal/config"
	"mutagenui/internal/keychain"
	"mutagenui/internal/mutagen"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the Wails-bound backend. All exported methods are callable from the
// frontend via window.go.main.App.<Method>.
type App struct {
	ctx          context.Context
	mu           sync.Mutex
	client       mutagen.Client
	cfg          config.Config
	extractErr   string
	debugLogPath string

	promptMu      sync.Mutex
	promptSeq     int
	pendingPrompt map[string]chan promptAnswer
}

type promptAnswer struct {
	value     string
	cancelled bool
	save      bool
}

// sshAccountRe extracts "user@host" from prompts like
// "user@1.2.3.4's password:" for use as the Keychain account key.
var sshAccountRe = regexp.MustCompile(`(\S+@\S+?)'s password`)

func NewApp() *App {
	return &App{pendingPrompt: make(map[string]chan promptAnswer)}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if cfg, err := config.Load(); err == nil {
		a.cfg = cfg
	}
	// 交互执行的调试日志，每次启动重写；定位"创建中卡住"这类问题用
	if dir, err := os.UserConfigDir(); err == nil {
		logPath := filepath.Join(dir, "MutagenUI", "debug.log")
		if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err == nil {
			if f, err := os.Create(logPath); err == nil {
				mutagen.DebugLog = f
				a.debugLogPath = logPath
			}
		}
	}
	a.client.BinaryPath = a.cfg.MutagenPath
	if p, err := bundled.Extract(); err == nil && p != "" {
		a.client.BundledPath = p
	} else if err != nil {
		a.extractErr = err.Error()
	}
	a.client.Prompter = a.askUser
	go a.client.EnsureDaemon()
}

// askUser answers an SSH prompt: first password request tries the macOS
// Keychain; otherwise (or after a rejected password) it forwards the prompt to
// the frontend as an event and blocks until AnswerPrompt delivers the
// response (or the wait times out).
func (a *App) askUser(prompt string, masked bool, attempt int) (string, bool) {
	account := ""
	if m := sshAccountRe.FindStringSubmatch(prompt); m != nil {
		account = m[1]
	}
	if masked && account != "" && attempt == 1 && keychain.Supported() {
		if pw, err := keychain.Get(account); err == nil && pw != "" {
			return pw, true
		}
	}

	a.promptMu.Lock()
	a.promptSeq++
	id := fmt.Sprintf("p%d", a.promptSeq)
	ch := make(chan promptAnswer, 1)
	a.pendingPrompt[id] = ch
	a.promptMu.Unlock()

	defer func() {
		a.promptMu.Lock()
		delete(a.pendingPrompt, id)
		a.promptMu.Unlock()
	}()

	runtime.EventsEmit(a.ctx, "ssh-prompt", map[string]any{
		"id":      id,
		"prompt":  prompt,
		"masked":  masked,
		"canSave": masked && account != "" && keychain.Supported(),
		"retry":   attempt > 1,
	})

	select {
	case ans := <-ch:
		if ans.cancelled {
			return "", false
		}
		if ans.save && account != "" && keychain.Supported() {
			if err := keychain.Set(account, ans.value); err != nil {
				runtime.EventsEmit(a.ctx, "toast-error", "保存到钥匙串失败: "+err.Error())
			}
		}
		return ans.value, true
	case <-time.After(3 * time.Minute):
		return "", false
	case <-a.ctx.Done():
		return "", false
	}
}

// Confirm shows a native confirmation dialog. Needed because WKWebView does
// not implement window.confirm/prompt. 注意平台差异：macOS 返回自定义按钮
// 文字（"确定"），Windows 不支持自定义按钮、返回英文 "Yes"/"No"。
func (a *App) Confirm(title, message string) bool {
	res, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type:          runtime.QuestionDialog,
		Title:         title,
		Message:       message,
		Buttons:       []string{"确定", "取消"},
		DefaultButton: "确定",
		CancelButton:  "取消",
	})
	if err != nil {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(res)) {
	case "确定", "yes", "ok":
		return true
	}
	return false
}

// AnswerPrompt is called by the frontend prompt dialog. save requests storing
// the password in the macOS Keychain for future auto-fill.
func (a *App) AnswerPrompt(id, answer string, cancelled, save bool) {
	a.promptMu.Lock()
	ch, ok := a.pendingPrompt[id]
	a.promptMu.Unlock()
	if ok {
		ch <- promptAnswer{value: answer, cancelled: cancelled, save: save}
	}
}

// MutagenInfo reports where the mutagen binary was found and its version,
// so the UI can show a clear setup error instead of failing on every call.
type MutagenInfo struct {
	OK       bool   `json:"ok"`
	Path     string `json:"path"`
	Version  string `json:"version"`
	Bundled  bool   `json:"bundled"`
	Error    string `json:"error"`
	DebugLog string `json:"debugLog"`
}

func (a *App) GetMutagenInfo() MutagenInfo {
	path, err := a.client.ResolveBinary()
	if err != nil {
		msg := err.Error()
		if a.extractErr != "" {
			msg += "（" + a.extractErr + "）"
		}
		return MutagenInfo{Error: msg}
	}
	version, err := a.client.Version()
	if err != nil {
		return MutagenInfo{Path: path, Error: err.Error()}
	}
	return MutagenInfo{
		OK:       true,
		Path:     path,
		Version:  version,
		Bundled:  path == a.client.BundledPath,
		DebugLog: a.debugLogPath,
	}
}

func (a *App) ListSessions() ([]mutagen.Session, error) {
	return a.client.List()
}

func (a *App) CreateSession(spec mutagen.CreateSpec) error {
	// mutagen 本身允许同名会话，但同名会让按名称操作和分组归属产生歧义，
	// 所以在创建前主动拦截。
	if spec.Name != "" {
		if list, err := a.client.List(); err == nil {
			for _, s := range list {
				if s.Name == spec.Name {
					return fmt.Errorf("已存在同名会话「%s」，请更换名称", spec.Name)
				}
			}
		}
	}
	return a.client.Create(spec)
}

func (a *App) PauseSession(name string) error     { return a.client.Pause(name) }
func (a *App) ResumeSession(name string) error    { return a.client.Resume(name) }
func (a *App) FlushSession(name string) error     { return a.client.Flush(name) }
func (a *App) ResetSession(name string) error     { return a.client.Reset(name) }
func (a *App) TerminateSession(name string) error { return a.client.Terminate(name) }

// SelectDirectory opens the native folder picker and returns the chosen path
// (empty string if cancelled).
func (a *App) SelectDirectory() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择本地目录",
	})
}

func (a *App) GetConfig() config.Config {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cfg
}

func (a *App) SetMutagenPath(path string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cfg.MutagenPath = path
	a.client.BinaryPath = path
	return config.Save(a.cfg)
}

// SavePreset adds or replaces a preset by name.
func (a *App) SavePreset(p config.Preset) error {
	if p.Name == "" {
		return fmt.Errorf("预设名称不能为空")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	replaced := false
	for i, existing := range a.cfg.Presets {
		if existing.Name == p.Name {
			a.cfg.Presets[i] = p
			replaced = true
			break
		}
	}
	if !replaced {
		a.cfg.Presets = append(a.cfg.Presets, p)
	}
	return config.Save(a.cfg)
}

// RenamePreset renames a preset, refusing collisions with existing names.
func (a *App) RenamePreset(oldName, newName string) error {
	if newName == "" {
		return fmt.Errorf("预设名称不能为空")
	}
	if oldName == newName {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, p := range a.cfg.Presets {
		if p.Name == newName {
			return fmt.Errorf("已存在同名预设: %s", newName)
		}
	}
	for i, p := range a.cfg.Presets {
		if p.Name == oldName {
			a.cfg.Presets[i].Name = newName
			return config.Save(a.cfg)
		}
	}
	return fmt.Errorf("预设不存在: %s", oldName)
}

// SaveLayout persists sidebar ordering/grouping.
func (a *App) SaveLayout(l config.Layout) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cfg.Layout = l
	return config.Save(a.cfg)
}

func (a *App) DeletePreset(name string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	kept := a.cfg.Presets[:0]
	for _, p := range a.cfg.Presets {
		if p.Name != name {
			kept = append(kept, p)
		}
	}
	a.cfg.Presets = kept
	return config.Save(a.cfg)
}
