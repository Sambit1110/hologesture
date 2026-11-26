#!/usr/bin/env bash
# Builds HoloGesture for every platform and puts the downloadable files,
# plus a SHA256SUMS file, in release/. Run on a Mac: npm run release
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
OUT=dist
REL=release
IGNORE='^/(dist|test|calibration|build|release|scripts|serve\.py|install\.sh|install\.ps1|\.gitignore|\.git|\.DS_Store)'
COMMON=(--out="$OUT" --overwrite --app-version="$VERSION" --ignore="$IGNORE")

rm -rf "$REL" && mkdir -p "$REL"

pack() { npx electron-packager . HoloGesture "$@" "${COMMON[@]}" >/dev/null; }

for arch in arm64 x64; do
  echo "• macOS $arch"
  pack --platform=darwin --arch="$arch" --icon=build/icon.icns \
    --app-bundle-id=local.hologesture --app-category-type=public.app-category.education \
    --extend-info=build/Info.extra.plist
  app="$OUT/HoloGesture-darwin-$arch/HoloGesture.app"
  # Local (ad-hoc) signature: required for Apple Silicon to run the app at all.
  codesign --force --deep --sign - --identifier local.hologesture "$app"
  ditto -c -k --keepParent "$app" "$REL/HoloGesture-mac-$arch.zip"
done

for arch in x64 arm64; do
  echo "• Linux $arch"
  pack --platform=linux --arch="$arch" --executable-name=hologesture
  cp build/icon.png "$OUT/HoloGesture-linux-$arch/hologesture.png"
  tar -C "$OUT" -czf "$REL/HoloGesture-linux-$arch.tar.gz" "HoloGesture-linux-$arch"
done

echo "• Windows x64"
pack --platform=win32 --arch=x64
cp build/icon.ico "$OUT/HoloGesture-win32-x64/HoloGesture.ico"
(cd "$OUT" && rm -f "../$REL/HoloGesture-windows-x64.zip" && zip -qry "../$REL/HoloGesture-windows-x64.zip" HoloGesture-win32-x64)

cp install.sh install.ps1 "$REL/"
(cd "$REL" && shasum -a 256 HoloGesture-* > SHA256SUMS)
echo
echo "Release $VERSION files:"
ls -lh "$REL"
