#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FFMPEG_VERSION="${FFMPEG_VERSION:-8.1.2}"
SOURCE_CACHE="$ROOT_DIR/.build/ffmpeg/darwin-arm64"
BUILD_ROOT="${AERUNE_FFMPEG_BUILD_ROOT:-/tmp/aerune-ffmpeg-darwin-arm64}"
SRC_ARCHIVE="$SOURCE_CACHE/ffmpeg-$FFMPEG_VERSION.tar.xz"
SIG_ARCHIVE="$SRC_ARCHIVE.asc"
SRC_DIR="$BUILD_ROOT/ffmpeg-$FFMPEG_VERSION"
PREFIX="$BUILD_ROOT/install"
VENDOR_DIR="$ROOT_DIR/vendor/ffmpeg/darwin-arm64"
LICENSE_DIR="$ROOT_DIR/licenses/ffmpeg"

mkdir -p "$SOURCE_CACHE" "$BUILD_ROOT" "$VENDOR_DIR" "$LICENSE_DIR"

if [ ! -f "$SRC_ARCHIVE" ]; then
  curl -L "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" -o "$SRC_ARCHIVE"
fi

if [ ! -f "$SIG_ARCHIVE" ]; then
  curl -L "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz.asc" -o "$SIG_ARCHIVE"
fi

if command -v gpg >/dev/null 2>&1; then
  if ! gpg --verify "$SIG_ARCHIVE" "$SRC_ARCHIVE"; then
    curl -L https://ffmpeg.org/ffmpeg-devel.asc | gpg --import
    gpg --verify "$SIG_ARCHIVE" "$SRC_ARCHIVE"
  fi
else
  echo "warning: gpg is not available; skipping FFmpeg signature verification" >&2
fi

rm -rf "$SRC_DIR" "$PREFIX"
tar -xf "$SRC_ARCHIVE" -C "$BUILD_ROOT"

(
  cd "$SRC_DIR"
  ./configure \
    --prefix="$PREFIX" \
    --arch=arm64 \
    --target-os=darwin \
    --cc=clang \
    --extra-cflags="-mmacosx-version-min=12.0" \
    --extra-ldflags="-mmacosx-version-min=12.0" \
    --disable-gpl \
    --disable-nonfree \
    --disable-libx264 \
    --disable-libx265 \
    --disable-libfdk-aac \
    --disable-debug \
    --disable-doc \
    --disable-ffplay \
    --disable-ffprobe \
    --disable-network \
    --enable-pthreads

  make -j"$(sysctl -n hw.ncpu)"
  make install
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git diff > "$VENDOR_DIR/changes.diff"
  else
    : > "$VENDOR_DIR/changes.diff"
  fi
  cp LICENSE.md "$LICENSE_DIR/FFmpeg-LICENSE.md"
  cp COPYING.LGPLv2.1 "$LICENSE_DIR/FFmpeg-COPYING.LGPLv2.1"
)

install -m 755 "$PREFIX/bin/ffmpeg" "$VENDOR_DIR/ffmpeg"
"$VENDOR_DIR/ffmpeg" -hide_banner -buildconf > "$VENDOR_DIR/FFmpeg_BUILD_CONFIG.txt" 2>&1
"$VENDOR_DIR/ffmpeg" -hide_banner -version > "$VENDOR_DIR/FFmpeg_VERSION.txt" 2>&1
shasum -a 256 "$VENDOR_DIR/ffmpeg" > "$VENDOR_DIR/ffmpeg.sha256"

"$ROOT_DIR/scripts/check-ffmpeg-lgpl.sh" "$VENDOR_DIR/ffmpeg"

cat > "$LICENSE_DIR/FFmpeg_NOTICE.txt" <<NOTICE
Aerune includes an independent FFmpeg command-line executable for local video compression.
FFmpeg is licensed under the GNU Lesser General Public License (LGPL).
The corresponding FFmpeg source, build configuration, and local changes must be attached to the same GitHub Release as the Aerune binary.
NOTICE

echo "FFmpeg macOS arm64 build completed: $VENDOR_DIR/ffmpeg"
