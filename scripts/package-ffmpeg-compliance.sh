#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
FFMPEG_VERSION="${FFMPEG_VERSION:-$(awk '/^ffmpeg version / { print $3; exit }' "$ROOT_DIR/vendor/ffmpeg/darwin-arm64/FFmpeg_VERSION.txt")}"

if [ -z "$FFMPEG_VERSION" ]; then
  echo "Unable to determine FFmpeg version" >&2
  exit 1
fi

SOURCE_CACHE="$ROOT_DIR/.build/ffmpeg/darwin-arm64"
SRC_ARCHIVE="$SOURCE_CACHE/ffmpeg-$FFMPEG_VERSION.tar.xz"
SIG_ARCHIVE="$SRC_ARCHIVE.asc"
OUT_DIR="$ROOT_DIR/dist/ffmpeg-lgpl-darwin-arm64-v$APP_VERSION"
OUT_ARCHIVE="$ROOT_DIR/dist/ffmpeg-lgpl-darwin-arm64-v$APP_VERSION.tar.gz"

mkdir -p "$SOURCE_CACHE" "$OUT_DIR" "$ROOT_DIR/dist"

if [ ! -f "$SRC_ARCHIVE" ]; then
  curl -L "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" -o "$SRC_ARCHIVE"
fi

if [ ! -f "$SIG_ARCHIVE" ]; then
  curl -L "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz.asc" -o "$SIG_ARCHIVE"
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/source" "$OUT_DIR/build" "$OUT_DIR/licenses"

cp -p "$SRC_ARCHIVE" "$OUT_DIR/source/"
cp -p "$SIG_ARCHIVE" "$OUT_DIR/source/"
cp -p "$ROOT_DIR/vendor/ffmpeg/darwin-arm64/FFmpeg_BUILD_CONFIG.txt" "$OUT_DIR/build/"
cp -p "$ROOT_DIR/vendor/ffmpeg/darwin-arm64/FFmpeg_VERSION.txt" "$OUT_DIR/build/"
cp -p "$ROOT_DIR/vendor/ffmpeg/darwin-arm64/changes.diff" "$OUT_DIR/build/"
cp -p "$ROOT_DIR/vendor/ffmpeg/darwin-arm64/ffmpeg.sha256" "$OUT_DIR/build/"
cp -p "$ROOT_DIR/licenses/ffmpeg/"* "$OUT_DIR/licenses/"

shasum -a 256 "$OUT_DIR/source/ffmpeg-$FFMPEG_VERSION.tar.xz" > "$OUT_DIR/source/ffmpeg-$FFMPEG_VERSION.tar.xz.sha256"

cat > "$OUT_DIR/README.md" <<README
# Aerune FFmpeg LGPL Compliance Assets

Aerune v$APP_VERSION includes an independent FFmpeg command-line executable for macOS arm64 video compression.

This archive contains:

- FFmpeg $FFMPEG_VERSION source archive and upstream signature
- FFmpeg source checksum
- The exact build configuration captured from the bundled executable
- Local changes.diff
- Checksum for the bundled FFmpeg executable
- FFmpeg LGPL license texts and Aerune notice

The bundled executable is invoked by Aerune with child_process.spawn and is not statically linked into the Electron app.
README

tar -czf "$OUT_ARCHIVE" -C "$ROOT_DIR/dist" "$(basename "$OUT_DIR")"
shasum -a 256 "$OUT_ARCHIVE" > "$OUT_ARCHIVE.sha256"

echo "Created $OUT_ARCHIVE"
