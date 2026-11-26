#!/usr/bin/env bash
# HoloGesture installer for macOS and Linux.
#
#   Install:    curl -fsSL https://github.com/Sambit1110/hologesture/releases/latest/download/install.sh | bash
#   Uninstall:  curl -fsSL https://github.com/Sambit1110/hologesture/releases/latest/download/install.sh | bash -s -- --uninstall
#
# Downloads the right build for this computer, checks its SHA-256 checksum,
# and installs it: macOS -> /Applications (or ~/Applications), Linux ->
# ~/.local/share/hologesture with a `hologesture` command and a menu entry.
set -euo pipefail

REPO="Sambit1110/hologesture"
BASE="${HOLOGESTURE_BASE_URL:-https://github.com/$REPO/releases/latest/download}"
# Optional: install the Mac app into a specific folder instead of Applications.
MAC_DIR="${HOLOGESTURE_INSTALL_DIR:-}"

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

os=$(uname -s)
arch=$(uname -m)
case "$arch" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64)  arch=x64 ;;
  *) fail "Unsupported processor: $arch" ;;
esac
case "$os" in
  Darwin) platform=mac ;;
  Linux)  platform=linux ;;
  *) fail "Unsupported system: $os. On Windows, run this in PowerShell instead: irm https://github.com/$REPO/releases/latest/download/install.ps1 | iex" ;;
esac
# A Terminal running under Rosetta on Apple Silicon reports x86_64: use the native build.
if [ "$platform" = mac ] && [ "$arch" = x64 ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
  arch=arm64
fi

LINUX_DIR="$HOME/.local/share/hologesture"
LINUX_BIN="$HOME/.local/bin/hologesture"
LINUX_DESKTOP="$HOME/.local/share/applications/hologesture.desktop"

if [ "${1:-}" = "--uninstall" ]; then
  if [ "$platform" = mac ]; then
    pkill -x HoloGesture 2>/dev/null || true
    if [ -n "$MAC_DIR" ]; then rm -rf "$MAC_DIR/HoloGesture.app"
    else rm -rf "/Applications/HoloGesture.app" "$HOME/Applications/HoloGesture.app"; fi
    say "HoloGesture removed. Your settings and calibration recordings are in ~/Library/Application Support/HoloGesture (delete that folder too if you like)."
  else
    pkill -x hologesture 2>/dev/null || true
    rm -rf "$LINUX_DIR" "$LINUX_BIN" "$LINUX_DESKTOP"
    say "HoloGesture removed. Your settings and calibration recordings are in ~/.config/HoloGesture (delete that folder too if you like)."
  fi
  exit 0
fi

command -v curl >/dev/null || fail "curl is needed to download HoloGesture."
if [ "$platform" = mac ]; then asset="HoloGesture-mac-$arch.zip"; else asset="HoloGesture-linux-$arch.tar.gz"; fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

say "Downloading HoloGesture for $os ($arch)…"
curl -fL --progress-bar "$BASE/$asset" -o "$tmp/$asset" || fail "Download failed: $BASE/$asset"
curl -fsSL "$BASE/SHA256SUMS" -o "$tmp/SHA256SUMS" || fail "Could not download the checksum file."

say "Checking the download…"
expected=$(awk -v f="$asset" '$2 == f {print $1}' "$tmp/SHA256SUMS")
[ -n "$expected" ] || fail "No checksum listed for $asset."
if command -v shasum >/dev/null; then actual=$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')
else actual=$(sha256sum "$tmp/$asset" | awk '{print $1}'); fi
[ "$expected" = "$actual" ] || fail "Checksum mismatch: the download is corrupted or was tampered with. Please try again."

if [ "$platform" = mac ]; then
  if [ -n "$MAC_DIR" ]; then dest="$MAC_DIR"; mkdir -p "$dest"
  else
    dest=/Applications
    [ -w "$dest" ] || { dest="$HOME/Applications"; mkdir -p "$dest"; }
  fi
  pkill -x HoloGesture 2>/dev/null || true
  rm -rf "$dest/HoloGesture.app"
  ditto -x -k "$tmp/$asset" "$dest"
  # Downloaded with curl, so macOS has not flagged it; clear the flag anyway in case.
  xattr -dr com.apple.quarantine "$dest/HoloGesture.app" 2>/dev/null || true
  say "Installed to $dest/HoloGesture.app"
  echo "    Open it from Launchpad or Spotlight, or run:  open -a HoloGesture"
  echo "    The first time you start the camera, macOS asks for permission: click Allow."
else
  tar -xzf "$tmp/$asset" -C "$tmp"
  pkill -x hologesture 2>/dev/null || true
  rm -rf "$LINUX_DIR"
  mkdir -p "$(dirname "$LINUX_DIR")" "$(dirname "$LINUX_BIN")" "$(dirname "$LINUX_DESKTOP")"
  mv "$tmp/HoloGesture-linux-$arch" "$LINUX_DIR"
  # Chromium's sandbox needs unprivileged user namespaces; some distros (e.g.
  # Ubuntu 24.04+) restrict them. The app only shows its own bundled files,
  # so in that case the launcher runs it without that sandbox.
  cat > "$LINUX_BIN" <<LAUNCHER
#!/bin/sh
flags=""
if [ "\$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ] || [ "\$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = 0 ]; then
  flags="--no-sandbox"
fi
exec "$LINUX_DIR/hologesture" \$flags "\$@"
LAUNCHER
  chmod +x "$LINUX_BIN"
  cat > "$LINUX_DESKTOP" <<DESKTOP
[Desktop Entry]
Type=Application
Name=HoloGesture
Comment=Control 3D holograms with your hands
Exec=$LINUX_BIN
Icon=$LINUX_DIR/hologesture.png
Categories=Education;Graphics;
Terminal=false
DESKTOP
  say "Installed to $LINUX_DIR"
  echo "    Open it from your app menu, or run:  hologesture"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) warn "~/.local/bin is not on your PATH, so run it as: $LINUX_BIN" ;;
  esac
fi
