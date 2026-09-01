# Native Android Studio Runtime — M56/M57

`apps/studio-runtime-android` is the production Android host for AI Animation Studio. The current runtime is **native Jetpack Compose** and intentionally does **not** bundle Studio Web, WebView, JavaScript bridges or browser production state.

The first certification target remains **POCO X6 Pro 5G / Android 16**. No physical-device PASS is claimed until the final exact-head APK is observed running on that real device and the required evidence is captured.

## Native architecture

The Android production path is source-bound and fail-closed:

1. App-private reference import stores exact source bytes and SHA-256.
2. M57 natural-language input compiles through a provider-neutral semantic boundary into strict Scene IR v1; deterministic mode remains an explicit regression path.
3. Executable natural-language Scene IR must preserve exact script SHA-256, reference SHA-256 and 40-character source commit and pass `NativeSceneTimelineCompiler` before production lowering.
4. Hash-bound compiled Scene IR + timeline may be stored app-privately and restored only when the raw script/reference/build identities still match and the persisted payload SHA-256 verifies.
5. Deterministic native blocking, performance and camera gates run before rendering.
6. Native frame rendering uses EGL/OpenGL ES and the exact admitted reference source.
7. Native export uses H.264 MediaCodec video + Opus MediaCodec audio, bounded MP4 mux/interleave, durable MediaStore save, saved SHA-256 and native decoder verification through EOS.

The Compose UI surfaces device/Android identity, exact source SHA, reference SHA-256, semantic status, Scene IR/timeline identity, persisted-plan SHA and MP4 verification evidence.

## M57 semantic trust boundary

The broad production language mechanism belongs behind the controlled server/proxy boundary represented by `NativeSceneProxySemanticBackend`. Provider API credentials are not accepted by the Android semantic interface and must never be packaged in the APK. The proxy request contains only natural-language scene text plus safe build/reference/actor/request identity; reference image bytes are not sent merely for language understanding.

External model/proxy JSON is parsed by `NativeExternalSceneIrV1Adapter` as untrusted data. Duplicate or unknown fields, identity drift, unsupported enum/capability names, malformed timing and oversized responses are rejected. Semantically understood capabilities that the current renderer cannot execute remain `UNSUPPORTED_CAPABILITY`; they are not silently dropped or converted into fake production readiness.

`BoundedNativeSceneSemanticBackend` supplies timeout, retry, cancellation and response-size bounds. Ordinary CI uses deterministic mocks and the offline supported-subset probe rather than a paid/live provider.

The offline probe supports deterministic Armenian/English/Russian/mixed-language certification of the admitted subset, but it is not advertised as broad language understanding or model parity.

## Build

Requirements:

- JDK 17
- Android SDK/platform 36
- Android Studio compatible with the current AGP/Gradle files

From this directory, an exact-source build passes the source identity explicitly, for example:

```bash
./gradlew :app:testReleaseUnitTest :app:lintRelease :app:assembleRelease \
  -PstudioCommitSha=<exact-40-char-source-sha> \
  -PstudioSourceDate=<iso-8601-source-date> \
  -PruntimeVersion=<runtime-version> \
  -PruntimeVersionCode=<integer-version-code>
```

A build with missing/development source identity is not acceptable final certification evidence.

## CI and APK provenance

`Native Android CI` is a release gate, not merely a compile job. For the exact workflow source SHA it requires:

- native-only source boundary (no `android.webkit`, AndroidX WebKit, legacy WebView bridge or coupled Studio Web build);
- no provider credential-like literals in source;
- M57 300-case multilingual semantic benchmark;
- release unit tests, lint and release APK assembly;
- release APK existence and Android signature verification;
- exact workflow source SHA embedded in APK bytecode;
- browser/WebView-free release bytecode;
- no provider credential-like literals in APK bytecode;
- APK SHA-256;
- signer-certificate SHA-256 from the actual Android build-tools `apksigner` output;
- provenance manifest binding source/build/workflow/APK/signer identities;
- exact artifact upload containing both `app-release.apk` and `M57_PROVENANCE.txt`.

A final APK is authoritative only when it comes from the same final exact head whose required Foundation CI and Native Android CI are both fully green. Historical APKs are never promoted merely because their own build succeeded.

## Real POCO physical proof

Final M57 proof must use the exact final APK on a **real POCO X6 Pro 5G running Android 16**. Emulator/simulator/browser automation is not physical evidence.

The device proof must visibly establish, at minimum:

- POCO/device identity and Android 16/API identity in the native app;
- the full exact source SHA matching the final green CI/provenance artifact;
- the exact imported reference identity;
- a real Armenian natural-language scene compile with visible semantic/timeline evidence;
- fail-closed handling for an unsupported natural-language capability;
- a supported natural-language subset reaching native production and H.264 + Opus MP4 export;
- `MP4_READY`, saved MP4 SHA-256, native track/decode verification, and playback of the saved video on the phone;
- no WebView/browser dependency in the production flow.

Until that observation is captured against the final exact-head artifact, physical proof and final merge readiness remain blocked.
