#!/usr/bin/env bash
set -euo pipefail

FFMPEG="${1:-vendor/ffmpeg/darwin-arm64/ffmpeg}"
PLATFORM="${2:-}"

if [ -z "$PLATFORM" ]; then
  case "$FFMPEG" in
    *darwin-arm64*) PLATFORM="darwin-arm64" ;;
    *win32-x64*) PLATFORM="win32-x64" ;;
    *) PLATFORM="generic" ;;
  esac
fi

if [ ! -x "$FFMPEG" ]; then
  echo "FFmpeg executable not found or not executable: $FFMPEG" >&2
  exit 1
fi

BUILD_CONF="$("$FFMPEG" -hide_banner -buildconf 2>&1)"
LICENSE_TEXT="$("$FFMPEG" -hide_banner -L 2>&1)"
ENCODERS="$("$FFMPEG" -hide_banner -encoders 2>&1)"
HWACCELS="$("$FFMPEG" -hide_banner -hwaccels 2>&1)"

for forbidden in \
  "--enable-gpl" \
  "--enable-nonfree" \
  "--enable-libx264" \
  "--enable-libx265" \
  "--enable-libfdk-aac"
do
  if printf '%s\n' "$BUILD_CONF" | grep -F -- "$forbidden" >/dev/null; then
    echo "Forbidden FFmpeg configure flag found: $forbidden" >&2
    exit 1
  fi
done

if printf '%s\n' "$ENCODERS" | grep -E '(^|[[:space:]])libx264([[:space:]]|$)' >/dev/null; then
  echo "Forbidden encoder found: libx264" >&2
  exit 1
fi

if printf '%s\n' "$ENCODERS" | grep -E '(^|[[:space:]])libx265([[:space:]]|$)' >/dev/null; then
  echo "Forbidden encoder found: libx265" >&2
  exit 1
fi

case "$PLATFORM" in
  darwin-arm64)
    if ! printf '%s\n' "$ENCODERS" | grep -F 'h264_videotoolbox' >/dev/null; then
      echo "Required encoder missing: h264_videotoolbox" >&2
      exit 1
    fi
    if ! printf '%s\n' "$HWACCELS" | grep -F 'videotoolbox' >/dev/null; then
      echo "Required hwaccel missing: videotoolbox" >&2
      exit 1
    fi
    ;;
  win32-x64)
    if ! printf '%s\n' "$ENCODERS" | grep -E '(^|[[:space:]])(h264_mf|libopenh264)([[:space:]]|$)' >/dev/null; then
      echo "Required Windows encoder missing: h264_mf or libopenh264" >&2
      exit 1
    fi
    ;;
esac

if printf '%s\n' "$LICENSE_TEXT" | grep -F 'GNU General Public License version 2' >/dev/null; then
  echo "FFmpeg reports GPL licensing instead of LGPL." >&2
  exit 1
fi

echo "FFmpeg LGPL audit passed: $FFMPEG"
