# Native Android Studio Runtime — M56 → M58

> Current production host for AI Animation Studio. Read repository `/AGENTS.md` and `/CANONICAL_MASTER_PLAN.md` first.

`apps/studio-runtime-android` is the **native Jetpack Compose** production runtime. It intentionally does **not** bundle Studio Web, WebView, JavaScript bridges, or browser production state.

Current canonical phase is **M58 / Phase 2**: preserve the verified M57 semantic baseline, bring M58 onto that green base, and make the real 3D mesh/skinning gate RUN + PASS before opening Character Modeling Phase 3.

The primary physical certification target remains **POCO X6 Pro 5G / Android 16** unless the canonical plan is explicitly changed. No final physical-device PASS is claimed until the final exact-head APK is observed on real hardware with matching provenance.

## Native architecture

The Android production path is source-bound and fail-closed:

1. App-private reference import stores exact source bytes and SHA-256.
2. Natural-language input crosses a provider-neutral semantic boundary into strict Scene IR; deterministic mode remains a regression path.
3. External semantic JSON is untrusted and must preserve script/reference/source identities and pass strict validation.
4. Hash-bound Scene IR/timeline persistence restores only when raw input/build identities and payload hashes still match.
5. Native blocking, performance, camera, 3D character and render gates run before export.
6. Native rendering uses EGL/OpenGL ES; M58 establishes the real mesh/skeleton/skinning contract and reference-driven reconstruction evidence.
7. Native export uses H.264 MediaCodec video + Opus MediaCodec audio, bounded MP4 mux/interleave, MediaStore save, saved SHA-256 and native decode-to-EOS verification.

## Semantic trust boundary

Broad language understanding belongs behind the controlled provider-neutral server/proxy boundary represented by `NativeSceneProxySemanticBackend`. Provider credentials are not accepted by the Android semantic interface and must never be packaged in the APK. Reference image bytes are not sent merely to understand language.

`NativeExternalSceneIrV1Adapter` treats proxy/model JSON as untrusted. Duplicate/unknown fields, identity drift, unsupported capabilities, malformed timing, oversized responses and invalid enums fail closed. Understood-but-unexecutable capability remains `UNSUPPORTED_CAPABILITY`; it is never silently dropped.

Ordinary CI uses deterministic mocks/offline supported-subset probes rather than a paid/live provider. The offline Armenian/English/Russian/mixed subset is regression coverage, not a claim of broad model parity.

## Build

Requirements: JDK 17, Android SDK/platform 36, and the repository Gradle/AGP toolchain.

Exact-source release-style verification passes source identity explicitly:

```bash
./gradlew :app:testReleaseUnitTest :app:lintRelease :app:assembleRelease \
  -PstudioCommitSha=<exact-40-char-source-sha> \
  -PstudioSourceDate=<iso-8601-source-date> \
  -PruntimeVersion=<runtime-version> \
  -PruntimeVersionCode=<positive-integer>
```

A missing/development source identity is not final certification evidence.

## CI and APK provenance

`Native Android CI` is the authoritative native APK/provenance gate. Foundation CI verifies retained shared foundations and a native compile checkpoint; legacy browser checks are compatibility-only and do not define release readiness.

For the exact workflow source SHA, Native Android CI requires:

- native-only runtime boundary: no `android.webkit`, AndroidX WebKit, legacy WebView bridge, or coupled Studio Web build;
- no provider credential-like literal in source or APK;
- M57 multilingual semantic benchmark;
- M58 real 3D mesh/skinning gate;
- release unit tests, lint and release APK assembly;
- APK existence and Android signature verification;
- exact workflow source SHA embedded in APK bytecode;
- browser/WebView-free release bytecode;
- APK SHA-256 and signer-certificate SHA-256;
- provenance binding source/build/workflow/APK/signer identities;
- artifact upload containing `app-release.apk` and `M58_PROVENANCE.txt`.

A final APK is authoritative only when it comes from the same final exact head whose required Foundation CI and Native Android CI are both fully green. Historical/debug APKs are never promoted merely because they built successfully.

## Physical proof and Golden Movie

Final certification must use the exact final APK on real target hardware. Emulator/simulator/browser automation is not physical evidence.

Physical proof ultimately must cover install/launch, project save/reopen, reference import, Armenian natural-language semantic compile, character/3D/performance/camera/lighting production, native MP4 export, saved SHA-256, decode/playback, long-task behavior and storage/cancellation behavior.

Project-level final PASS is the canonical **Golden Movie** acceptance test from real reference + natural-language scenario through the full native production chain to a watchable QC-passing MP4 on the real device.
