package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"mutagenui/internal/mutagen"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// 图片速传：把本地图片复制进会话 alpha 端的 mutagen_pic/ 目录，flush 等待
// 同步完成，然后返回远端路径供粘贴给 VPS 上的 Claude 等工具。
// 进度通过 "pic-progress" 事件推送：{session, stage: copy|flush, done, total}。

var imageExts = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true,
	".webp": true, ".heic": true, ".bmp": true, ".tiff": true, ".svg": true,
}

const picDir = "mutagen_pic"

// SentImage is one transferred image with its resulting remote paths.
type SentImage struct {
	Name      string `json:"name"`
	RemoteAbs string `json:"remoteAbs"`
	RemoteRel string `json:"remoteRel"`
}

// ImageBlob is a pasted clipboard image (base64-encoded).
type ImageBlob struct {
	Name string `json:"name"`
	Data string `json:"data"`
}

// SelectImages opens the native multi-file picker filtered to images.
func (a *App) SelectImages() ([]string, error) {
	return runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择图片",
		Filters: []runtime.FileFilter{
			{DisplayName: "图片", Pattern: "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.heic;*.bmp;*.tiff;*.svg"},
		},
	})
}

// SendImagesToSession copies image files into <alpha>/mutagen_pic/, flushes
// the session so they reach the remote side, and returns the remote paths.
func (a *App) SendImagesToSession(idOrName string, files []string) ([]SentImage, error) {
	sess, destDir, err := a.picTarget(idOrName)
	if err != nil {
		return nil, err
	}
	var accepted []string
	for _, f := range files {
		if imageExts[strings.ToLower(filepath.Ext(f))] {
			accepted = append(accepted, f)
		}
	}
	if len(accepted) == 0 {
		return nil, fmt.Errorf("没有可用的图片文件（支持 png/jpg/jpeg/gif/webp/heic/bmp/tiff/svg）")
	}

	var sent []SentImage
	for i, f := range accepted {
		a.emitPicProgress(sess.Identifier, "copy", i, len(accepted))
		name, err := uniqueName(destDir, filepath.Base(f))
		if err != nil {
			return nil, err
		}
		if err := copyFile(f, filepath.Join(destDir, name)); err != nil {
			return nil, fmt.Errorf("复制 %s 失败: %v", filepath.Base(f), err)
		}
		sent = append(sent, a.sentImage(sess, name))
	}
	return sent, a.flushForImages(sess, len(sent))
}

// SendImageBlobs writes pasted clipboard images into mutagen_pic/ and syncs.
func (a *App) SendImageBlobs(idOrName string, blobs []ImageBlob) ([]SentImage, error) {
	sess, destDir, err := a.picTarget(idOrName)
	if err != nil {
		return nil, err
	}
	if len(blobs) == 0 {
		return nil, fmt.Errorf("剪贴板中没有图片")
	}
	var sent []SentImage
	for i, b := range blobs {
		a.emitPicProgress(sess.Identifier, "copy", i, len(blobs))
		data, err := base64.StdEncoding.DecodeString(b.Data)
		if err != nil {
			return nil, fmt.Errorf("解码粘贴的图片失败: %v", err)
		}
		base := filepath.Base(b.Name)
		if base == "" || base == "." {
			base = "pasted.png"
		}
		name, err := uniqueName(destDir, base)
		if err != nil {
			return nil, err
		}
		if err := os.WriteFile(filepath.Join(destDir, name), data, 0o644); err != nil {
			return nil, fmt.Errorf("写入 %s 失败: %v", name, err)
		}
		sent = append(sent, a.sentImage(sess, name))
	}
	return sent, a.flushForImages(sess, len(sent))
}

// picTarget resolves the session and ensures <alpha>/mutagen_pic exists.
func (a *App) picTarget(idOrName string) (*mutagen.Session, string, error) {
	list, err := a.client.List()
	if err != nil {
		return nil, "", err
	}
	var sess *mutagen.Session
	for i := range list {
		if list[i].Identifier == idOrName || list[i].Name == idOrName {
			sess = &list[i]
			break
		}
	}
	if sess == nil {
		return nil, "", fmt.Errorf("会话不存在: %s", idOrName)
	}
	if !sess.AlphaLocal || sess.AlphaPath == "" {
		return nil, "", fmt.Errorf("该会话的 alpha 端不是本地目录，无法放置图片")
	}
	if sess.Paused {
		return nil, "", fmt.Errorf("会话已暂停，请先恢复再传图片")
	}
	destDir := filepath.Join(sess.AlphaPath, picDir)
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return nil, "", fmt.Errorf("无法创建 %s: %v", picDir, err)
	}
	return sess, destDir, nil
}

func (a *App) sentImage(sess *mutagen.Session, name string) SentImage {
	return SentImage{
		Name:      name,
		RemoteAbs: path.Join(sess.BetaPath, picDir, name),
		RemoteRel: path.Join(picDir, name),
	}
}

func (a *App) flushForImages(sess *mutagen.Session, count int) error {
	a.emitPicProgress(sess.Identifier, "flush", count, count)
	target := sess.Name
	if target == "" {
		target = sess.Identifier
	}
	if err := a.client.Flush(target); err != nil {
		return fmt.Errorf("图片已复制到本地 %s/，但同步失败: %v", picDir, err)
	}
	return nil
}

func (a *App) emitPicProgress(session, stage string, done, total int) {
	runtime.EventsEmit(a.ctx, "pic-progress", map[string]any{
		"session": session,
		"stage":   stage,
		"done":    done,
		"total":   total,
	})
}

// uniqueName returns base, or base-2.ext / base-3.ext ... if it already
// exists, so repeated screenshots with identical names don't overwrite.
func uniqueName(dir, base string) (string, error) {
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	name := base
	for i := 2; ; i++ {
		if _, err := os.Stat(filepath.Join(dir, name)); os.IsNotExist(err) {
			return name, nil
		} else if err != nil && !os.IsNotExist(err) {
			return "", err
		}
		if i > 1000 {
			return "", fmt.Errorf("无法为 %s 生成唯一文件名", base)
		}
		name = fmt.Sprintf("%s-%d%s", stem, i, ext)
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(dst)
		return err
	}
	return out.Close()
}
