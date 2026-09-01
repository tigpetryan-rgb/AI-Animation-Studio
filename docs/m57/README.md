# M57 — Multilingual Natural-Language Scene Compiler

M57 adds a semantic compiler boundary without making model output a renderer command and without returning WebView/browser dependencies to Android production.

## Trust pipeline

Raw Unicode Armenian / English / Russian scene text → provider-neutral semantic backend → strict external Scene IR v1 adapter → exact identity/schema/security validation → native capability registry → deterministic timeline compiler → hash-bound compiled-plan persistence → admitted native production/render/export path.

The canonical external contract is `scene-ir-v1.schema.json`. It is strict (`additionalProperties: false`) and carries original/normalized text provenance, script SHA-256, exact build SHA, exact reference SHA-256, provider/model/request evidence, stable entity/scene/shot IDs, explicit camera/timing/actions, continuity, output settings, warnings/unresolved terms and renderer-capability requirements.

`NativeExternalSceneIrV1Adapter` treats every model/proxy response as untrusted data. It rejects duplicate JSON fields, unknown fields, unknown enum/capability names, malformed or oversized structures, identity drift, invalid shot/action references, timing gaps/overlaps, and output/camera values outside bounded contracts. It never gives a model filesystem, network, codec or renderer-command authority.

The Android Kotlin representation is intentionally narrower than the external schema where the current native renderer is narrower. Semantically understood concepts outside the verified renderer map are preserved as semantic IR and rejected with `UNSUPPORTED_CAPABILITY`; they are never silently dropped and never produce fake `READY_FOR_RENDER`.

## Model boundary

`NativeSceneSemanticBackend` is provider-neutral. `NativeSceneProxySemanticBackend` defines the first-party controlled proxy boundary. Its request envelope contains only the scene text and safe compilation identity (`request_id`, exact source commit, exact reference SHA-256 and actor ID). Provider credentials and reference-image bytes are not part of that interface and do not belong in the APK.

`BoundedNativeSceneSemanticBackend` enforces finite timeout, bounded retries, cancellation polling and structured-response size limits. Timeout/cancel/unavailable/oversize failures retain category-specific diagnostics across the compiler boundary. Exhausted backend failure is explicit and fail-closed.

Ordinary CI does not call a paid/live model. Deterministic mocks and the local supported-subset semantic probe validate the compiler, schema, capability, security, persistence and physical supported-subset workflows without a provider secret or network call.

The local `NativeSupportedSubsetSemanticProbe` is **not** the broad production understanding mechanism and is **not** Runway parity. Broad typo/synonym/contextual understanding belongs behind the controlled server/proxy model backend.

## Language and capability behavior

The offline supported-subset probe recognizes Armenian, English and Russian, and `MIXED` input activates all language-family recognizers instead of choosing only one branch. It canonicalizes admitted concepts such as wait/speak/react/sit/stand and also recognizes unsupported interaction/camera/lighting/environment concepts so those intents fail closed truthfully instead of being lost as ambiguity.

The current source-bound native renderer/performance stack admits only `WAIT`, `SPEAK`, `REACT`, `SIT`, and `STAND` through the deterministic bridge. Walking/running toward semantic targets, look-at targets, pick-up/open/close interactions, arbitrary camera movement, lighting changes and environment changes remain semantic concepts but fail closed until verified mappings exist.

The legacy deterministic parser remains available as an explicit regression mode, including the proven `ACTOR WAIT ...` path.

## Timing and production gate

`NativeSceneTimelineCompiler` is a mandatory production gate for executable natural-language Scene IR. It enforces:

- at most 32 shots and 128 scheduled event references;
- finite non-negative starts and positive finite durations;
- exact start at 0 and contiguous shot boundaries (no gap/overlap);
- exact total scene-duration budget;
- known action IDs with no silently unscheduled action;
- camera focus bound to admitted exact source identity.

`NativeProductionSnapshot` carries both the compiled Scene IR and the source/reference/script-bound timeline. Natural-language production cannot lower into the deterministic production path unless the timeline passes and preserves exact identity. The Compose UI exposes semantic status, full script SHA-256, timeline identity, shot count/duration and the compiled-plan persistence digest.

## Hash-bound persistence and reload

`NativeScenePlanStore` persists executable Scene IR + timeline in an app-private bounded binary envelope with a payload SHA-256. Persist requires exact raw-script hash, exact reference SHA-256, exact source commit, executable capabilities and deterministic timeline revalidation.

Reload is admitted only when current raw script bytes, reference SHA-256 and exact source commit match the persisted identities and the payload hash is intact. Mismatch, malformed data or tamper deletes the stale stored plan and returns no result. `NativeCompiledSceneRuntime` then revalidates the timeline and capability set again before re-entering deterministic production; no semantic backend is called during a verified reload.

## Security/provenance invariants

- Original script is preserved and SHA-256 bound.
- Scene compilation binds exact BuildConfig source SHA and exact reference-image SHA-256.
- Script/reference/build edits invalidate compiled production state.
- Arbitrary URL/file/shell/JavaScript directives are rejected as data-boundary violations.
- Model output has no direct filesystem/network/codec authority.
- Provider credentials are excluded from the Android compiler/proxy interface and Native CI scans source + release APK for provider credential-like literals.
- Native CI also verifies the release APK is browser/WebView-free, embeds the exact source SHA, has a valid signature, records APK SHA-256 and signer-certificate SHA-256, and uploads a provenance manifest with the exact artifact.
- Existing H.264 MediaCodec Surface+EGL, Opus-only 48 kHz mono 96 kbps, bounded MP4 mux/interleave, durable save, saved SHA-256 and native decoder-verification gates remain downstream.

## Readiness truth

M57 is merge-ready only when the same final exact head has all required Foundation and Native Android CI green, compiler/security/benchmark gates green, exact-head APK provenance independently verified, and a real POCO X6 Pro 5G / Android 16 proof using that exact APK.

The physical proof must visibly bind device identity and the full source SHA, demonstrate a real Armenian natural-language compile, show unsupported parts fail closed, complete an admitted natural-language subset through native H.264 + Opus MP4 export, and verify on-phone playback. Emulator/simulator evidence is not a substitute.

No PR is merged as part of M57 verification without a separate explicit user instruction.
