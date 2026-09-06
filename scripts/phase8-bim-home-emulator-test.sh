#!/usr/bin/env bash
set -euo pipefail

SOURCE_SHA="${GITHUB_SHA:?GITHUB_SHA is required}"
SOURCE_DATE="$(git show -s --format=%cI "$SOURCE_SHA")"
RUN_NUMBER="${GITHUB_RUN_NUMBER:?GITHUB_RUN_NUMBER is required}"
APP_ID="com.aianimationstudio.runtime"
TEST_APP_ID="com.aianimationstudio.runtime.test"
REMOTE_DIR="/sdcard/Android/data/${APP_ID}/files/Movies"
RESULT_FILE="$(mktemp)"

cd apps/studio-runtime-android
./gradlew \
  :app:assembleDebug \
  :app:assembleDebugAndroidTest \
  -PstudioCommitSha="$SOURCE_SHA" \
  -PstudioSourceDate="$SOURCE_DATE" \
  -PruntimeVersion="0.10.6-phase8-bim-home+${SOURCE_SHA:0:12}" \
  -PruntimeVersionCode="$RUN_NUMBER" \
  --no-daemon

adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk

set +e
adb shell am instrument -w -r \
  -e class com.aianimationstudio.runtime.NativePhase8BimHomeWalkInstrumentedTest \
  "${TEST_APP_ID}/androidx.test.runner.AndroidJUnitRunner" | tee "$RESULT_FILE"
INSTRUMENT_STATUS=${PIPESTATUS[0]}
set -e

if [[ "$INSTRUMENT_STATUS" -ne 0 ]] || grep -q -E 'FAILURES!!!|INSTRUMENTATION_FAILED|shortMsg=' "$RESULT_FILE" || ! grep -q 'OK (1 test)' "$RESULT_FILE"; then
  echo "Phase-8 Bim home instrumentation did not complete successfully." >&2
  cat "$RESULT_FILE" >&2
  exit 1
fi
cd ../..

rm -rf phase8-bim-home-artifact
mkdir -p phase8-bim-home-artifact
adb shell test -d "$REMOTE_DIR"
adb pull "$REMOTE_DIR/." phase8-bim-home-artifact/

FRAME_DIR="$(find phase8-bim-home-artifact -type d -name 'phase8-bim-home-frames' -print -quit)"
MANIFEST="$(find phase8-bim-home-artifact -type f -name 'phase8-bim-home-manifest.txt' -print -quit)"
test -n "$FRAME_DIR" && test -d "$FRAME_DIR"
test -n "$MANIFEST" && test -s "$MANIFEST"
FRAME_COUNT="$(find "$FRAME_DIR" -maxdepth 1 -type f -name 'frame-*.png' | wc -l | tr -d '[:space:]')"
echo "Native Bim frame count: $FRAME_COUNT"
test "$FRAME_COUNT" = "300"

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y ffmpeg
fi

ROOT_MANIFEST="phase8-bim-home-artifact/phase8-bim-home-manifest.txt"
if [[ "$(realpath "$MANIFEST")" != "$(realpath -m "$ROOT_MANIFEST")" ]]; then cp "$MANIFEST" "$ROOT_MANIFEST"; fi
MP4="phase8-bim-home-artifact/phase8-bim-home-${SOURCE_SHA:0:12}.mp4"
WEBP="phase8-bim-home-artifact/phase8-bim-home-${SOURCE_SHA:0:12}.webp"

ffmpeg -y -hide_banner -loglevel error \
  -framerate 30 -start_number 0 -i "$FRAME_DIR/frame-%03d.png" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p \
  -profile:v baseline -level 3.0 -g 30 -keyint_min 30 -sc_threshold 0 \
  -movflags +faststart -tag:v avc1 -an "$MP4"

ffmpeg -y -hide_banner -loglevel error \
  -framerate 30 -start_number 0 -i "$FRAME_DIR/frame-%03d.png" \
  -c:v libwebp_anim -lossless 0 -q:v 78 -loop 0 -an "$WEBP"

ENCODED_FRAMES="$(ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of default=nw=1:nk=1 "$MP4" | tr -d '[:space:]')"
test "$ENCODED_FRAMES" = "300"
FRAME_RATE="$(ffprobe -v error -select_streams v:0 -show_entries stream=avg_frame_rate -of default=nw=1:nk=1 "$MP4" | tr -d '[:space:]')"
test "$FRAME_RATE" = "30/1"
DURATION="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$MP4" | tr -d '[:space:]')"
python3 - "$DURATION" <<'PY'
import sys
value=float(sys.argv[1])
assert abs(value-10.0) <= 0.05, value
PY
AUDIO_STREAMS="$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$MP4" | sed '/^$/d' | wc -l | tr -d '[:space:]')"
test "$AUDIO_STREAMS" = "0"

test -s "$MP4" && test -s "$WEBP"
cp "$FRAME_DIR/frame-000.png" phase8-bim-home-artifact/bim-preview-1.png
cp "$FRAME_DIR/frame-075.png" phase8-bim-home-artifact/bim-preview-2.png
cp "$FRAME_DIR/frame-150.png" phase8-bim-home-artifact/bim-preview-3.png
cp "$FRAME_DIR/frame-225.png" phase8-bim-home-artifact/bim-preview-4.png
cp "$FRAME_DIR/frame-299.png" phase8-bim-home-artifact/bim-preview-5.png
rm -rf "$FRAME_DIR"
sha256sum "$MP4" "$WEBP" > phase8-bim-home-artifact/phase8-bim-home.sha256
