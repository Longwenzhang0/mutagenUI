#!/usr/bin/env bash
# 下载内置的 mutagen 二进制到 internal/bundled/assets/（不入 git 仓库）。
# agents 包会被裁剪到只含 linux_amd64/linux_arm64（远端代理平台），
# 需要同步到其他系统的远端时，把官方完整 mutagen-agents.tar.gz 里的
# 对应条目补进来重新打包即可。
#
# 用法: ./fetch-assets.sh [--force]
set -euo pipefail

MUTAGEN_VERSION="0.18.1"
BASE_URL="https://github.com/mutagen-io/mutagen/releases/download/v${MUTAGEN_VERSION}"
ASSETS_DIR="$(cd "$(dirname "$0")" && pwd)/internal/bundled/assets"
AGENT_PLATFORMS=(linux_amd64 linux_arm64)
FORCE="${1:-}"

fetch_target() {
  local target="$1" archive="$2" bin_name="$3"
  local dest="$ASSETS_DIR/$target"

  if [[ -f "$dest/$bin_name" && -f "$dest/mutagen-agents.tar.gz" && "$FORCE" != "--force" ]]; then
    echo "[skip] $target 已存在（--force 可重新下载）"
    return
  fi

  echo "[fetch] $archive"
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  curl -fsSL -o "$tmp/$archive" "$BASE_URL/$archive"
  if [[ "$archive" == *.zip ]]; then
    unzip -o -q "$tmp/$archive" -d "$tmp/pkg"
  else
    mkdir -p "$tmp/pkg"
    tar -xzf "$tmp/$archive" -C "$tmp/pkg"
  fi

  mkdir -p "$tmp/agents" "$dest"
  tar -xzf "$tmp/pkg/mutagen-agents.tar.gz" -C "$tmp/agents" "${AGENT_PLATFORMS[@]}"
  tar -czf "$dest/mutagen-agents.tar.gz" -C "$tmp/agents" "${AGENT_PLATFORMS[@]}"
  cp "$tmp/pkg/$bin_name" "$dest/$bin_name"
  echo "[done] $target"
}

fetch_target darwin_amd64  "mutagen_darwin_amd64_v${MUTAGEN_VERSION}.tar.gz"  mutagen
fetch_target darwin_arm64  "mutagen_darwin_arm64_v${MUTAGEN_VERSION}.tar.gz"  mutagen
fetch_target windows_amd64 "mutagen_windows_amd64_v${MUTAGEN_VERSION}.zip"    mutagen.exe

echo "全部完成，资产位于 $ASSETS_DIR"
