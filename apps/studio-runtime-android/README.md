# M55 — Studio Controlled Runtime (Android)

This app is the first controlled-runtime host for AI Animation Studio. It is intentionally separate from the browser-only M54 physical-device evidence path.

## Minimal architecture

1. `apps/studio-web` is built at Android build time with an injected exact Studio commit SHA/source date.
2. The generated `dist/` is bundled into the APK under `assets/studio/`.
3. AndroidX `WebViewAssetLoader` serves those files from the secure `https://appassets.androidplatform.net` origin.
4. A narrow `StudioRuntimeAndroid` JavaScript interface exposes only:
   - runtime/device identity;
   - relevant hardware/media codec inventory;
   - chunked native file writes with SHA-256;
   - native MP4 container/metadata/first-frame inspection.
5. Navigation outside the bundled Studio origin is blocked.

The first certification target is **POCO X6 Pro 5G / Android 16**. No physical-device PASS is claimed by this branch until the APK is run on that real hardware and evidence is captured.

## Build

Requirements:

- JDK 17
- Android SDK 36
- Node/npm for the Studio web build
- Android Studio compatible with AGP 8.13.x

From this directory:

```bash
./gradlew :app:assembleDebug \
  -PstudioCommitSha=<exact-40-char-studio-sha> \
  -PstudioSourceDate=<iso-8601-source-date> \
  -PruntimeVersion=0.1.0-dev
```

The wrapper scripts download the official Gradle 8.13 wrapper JAR on first use if it is not already present.

If `studioCommitSha` is omitted, the debug build uses all-zero development identity. Such a build is explicitly **not** exact-build-bound certification evidence.

## Security / evidence boundary

`emulated=false` in runtime identity is based on fail-closed emulator heuristics. It is a runtime signal, not a substitute for observing that the app is running on a real physical device.

M55 certification evidence must eventually bind:

- exact Studio repository + 40-character Studio commit SHA;
- Studio source date;
- Runtime application id + runtime version/build;
- Android build/device identity;
- WebView package/version;
- codec inventory;
- native save SHA-256;
- native deterministic MP4 playback/decode verification.

The current MP4 native method intentionally returns `deterministicPlaybackVerified=false`. It proves track presence, metadata, dimensions, duration and first-frame decode only. A later M55 step must add a decoder/playback gate before this can contribute to a production PASS.
