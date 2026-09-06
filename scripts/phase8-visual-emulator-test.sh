#!/usr/bin/env bash
set -euo pipefail

SOURCE_SHA="${GITHUB_SHA:?GITHUB_SHA is required}"
SOURCE_DATE="$(git show -s --format=%cI "$SOURCE_SHA")"
RUN_NUMBER="${GITHUB_RUN_NUMBER:?GITHUB_RUN_NUMBER is required}"

cd apps/studio-runtime-android
./gradlew \
  :app:connectedDebugAndroidTest \
  -PstudioCommitSha="$SOURCE_SHA" \
  -PstudioSourceDate="$SOURCE_DATE" \
  -PruntimeVersion="0.10.2-phase8-visual+${SOURCE_SHA:0:12}" \
  -PruntimeVersionCode="$RUN_NUMBER" \
  --no-daemon
cd ../..

rm -rf phase8-visual-artifact
mkdir -p phase8-visual-artifact
adb pull /sdcard/Android/data/com.aianimationstudio.runtime/files/Movies/. phase8-visual-artifact/
