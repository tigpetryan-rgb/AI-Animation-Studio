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
  -PruntimeVersion="0.10.3-phase8-motion+${SOURCE_SHA:0:12}" \
  -PruntimeVersionCode="$RUN_NUMBER" \
  --no-daemon

adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk

set +e
adb shell am instrument -w -r \
  -e class com.aianimationstudio.runtime.NativePhase8CharacterMotionProofInstrumentedTest \
  "${TEST_APP_ID}/androidx.test.runner.AndroidJUnitRunner" | tee "$RESULT_FILE"
INSTRUMENT_STATUS=${PIPESTATUS[0]}
set -e

if [[ "$INSTRUMENT_STATUS" -ne 0 ]] || grep -q -E 'FAILURES!!!|INSTRUMENTATION_FAILED|shortMsg=' "$RESULT_FILE" || ! grep -q 'OK (1 test)' "$RESULT_FILE"; then
  echo "Phase-8 locked-camera character-motion instrumentation did not complete successfully." >&2
  cat "$RESULT_FILE" >&2
  exit 1
fi
cd ../..

rm -rf phase8-visual-artifact
mkdir -p phase8-visual-artifact
adb shell test -d "$REMOTE_DIR"
adb pull "$REMOTE_DIR/." phase8-visual-artifact/

FRAME_DIR="phase8-visual-artifact/phase8-motion-frames"
test -d "$FRAME_DIR"
FRAME_COUNT="$(find "$FRAME_DIR" -maxdepth 1 -type f -name 'frame-*.png' | wc -l | tr -d ' ')"
test "$FRAME_COUNT" = "168"
test -s phase8-visual-artifact/phase8-motion-manifest.txt
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null

MOTION_MP4="phase8-visual-artifact/phase8-character-motion-${SOURCE_SHA:0:12}.mp4"
MOTION_GIF="phase8-visual-artifact/phase8-character-motion-${SOURCE_SHA:0:12}.gif"

ffmpeg -y -hide_banner -loglevel error \
  -framerate 12 -start_number 0 -i "$FRAME_DIR/frame-%03d.png" \
  -c:v libx264 -preset medium -crf 18 \
  -pix_fmt yuv420p -profile:v baseline -level 3.0 \
  -movflags +faststart -an \
  "$MOTION_MP4"

ffmpeg -y -hide_banner -loglevel error \
  -i "$MOTION_MP4" \
  -filter_complex "[0:v]fps=12,scale=320:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=5" \
  -loop 0 \
  "$MOTION_GIF"

ENCODED_FRAMES="$(ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of default=nw=1:nk=1 "$MOTION_MP4")"
test "$ENCODED_FRAMES" = "168"
AUDIO_STREAMS="$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$MOTION_MP4" | sed '/^$/d' | wc -l | tr -d ' ')"
test "$AUDIO_STREAMS" = "0"

test -s "$MOTION_MP4"
test -s "$MOTION_GIF"
cp "$FRAME_DIR/frame-000.png" phase8-visual-artifact/phase8-character-preview-1.png
cp "$FRAME_DIR/frame-010.png" phase8-visual-artifact/phase8-character-preview-2.png
cp "$FRAME_DIR/frame-072.png" phase8-visual-artifact/phase8-character-preview-3.png
cp "$FRAME_DIR/frame-094.png" phase8-visual-artifact/phase8-character-preview-4.png
rm -rf "$FRAME_DIR"

sha256sum "$MOTION_MP4" "$MOTION_GIF" > phase8-visual-artifact/phase8-character-motion.sha256
