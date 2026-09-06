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
  -PruntimeVersion="0.10.2-phase8-visual+${SOURCE_SHA:0:12}" \
  -PruntimeVersionCode="$RUN_NUMBER" \
  --no-daemon

adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk

set +e
adb shell am instrument -w -r \
  -e class com.aianimationstudio.runtime.NativePhase8VisualAnimationInstrumentedTest \
  "${TEST_APP_ID}/androidx.test.runner.AndroidJUnitRunner" | tee "$RESULT_FILE"
INSTRUMENT_STATUS=${PIPESTATUS[0]}
set -e

if [[ "$INSTRUMENT_STATUS" -ne 0 ]] || grep -q -E 'FAILURES!!!|INSTRUMENTATION_FAILED|shortMsg=' "$RESULT_FILE" || ! grep -q 'OK (1 test)' "$RESULT_FILE"; then
  echo "Phase-8 video-only instrumentation did not complete successfully." >&2
  cat "$RESULT_FILE" >&2
  exit 1
fi
cd ../..

rm -rf phase8-visual-artifact
mkdir -p phase8-visual-artifact
adb shell test -d "$REMOTE_DIR"
adb pull "$REMOTE_DIR/." phase8-visual-artifact/

test -n "$(find phase8-visual-artifact -maxdepth 1 -type f -name 'phase8-visual-*.mp4' -print -quit)"
test -s phase8-visual-artifact/phase8-visual-preview-1.png
test -s phase8-visual-artifact/phase8-visual-preview-2.png
test -s phase8-visual-artifact/phase8-visual-preview-3.png
test -s phase8-visual-artifact/phase8-visual-manifest.txt
