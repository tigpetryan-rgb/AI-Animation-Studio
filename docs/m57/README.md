# M57 — Multilingual Natural-Language Scene Compiler

M57 adds a semantic compiler boundary without making model output a renderer command and without returning WebView/browser dependencies to Android production.

## Trust pipeline

Raw Unicode Armenian / English / Russian scene text → `NativeSceneSemanticBackend` → strict versioned Scene IR → identity/schema/security validation → capability registry → deterministic timeline compiler → admitted existing native production/render/export path.

The canonical external contract is `scene-ir-v1.schema.json`. It is strict (`additionalProperties: false`) and carries original/normalized text provenance, script SHA-256, exact build SHA, exact reference SHA-256, provider/model/request evidence, stable entity/scene/shot IDs, explicit camera/timing/actions, continuity, output settings, warnings/unresolved terms and renderer-capability requirements.

The Android Kotlin representation is intentionally narrower while M57 is staged: only fields consumed or validated by the current native stack are executable. Semantically understood concepts outside the current renderer map are preserved as semantic IR and rejected with `UNSUPPORTED_CAPABILITY`; they are never silently dropped and never produce fake `READY_FOR_RENDER`.

## Model boundary

`NativeSceneSemanticBackend` is provider-neutral. A production cloud implementation must call a server-side compiler endpoint/proxy where provider credentials remain server-side. The APK must contain no provider key. Android sends only script text plus safe identity/context needed for semantic compilation; reference-image bytes are not required for language semantics and must not be uploaded merely to compile text.

`BoundedNativeSceneSemanticBackend` enforces a finite timeout, bounded retries, cancellation polling and structured-response size limits. Exhausted model/network failure is explicit and fail-closed. Ordinary CI does not call a paid/live model; deterministic mocks and the local supported-subset semantic probe validate the contract and physical supported-subset workflow.

The local `NativeSupportedSubsetSemanticProbe` is **not** the broad production understanding mechanism and is **not** Runway parity. It exists so compiler/schema/capability/export behavior can be tested deterministically without a secret or network call. Broad typo/synonym/contextual Armenian understanding belongs behind the secure model backend.

## Current truthful executable capability set

The current source-bound M56 renderer/performance stack admits only the concepts that can be mapped without inventing contact geometry or generated imagery. M57 initially admits `WAIT`, `SPEAK`, `REACT`, `SIT`, and `STAND` through the deterministic legacy bridge. Walking/running toward semantic targets, look-at targets, pick-up/open/close interactions, arbitrary camera movement, lighting changes and environment changes remain semantic concepts but fail closed as unsupported until the renderer has verified mappings.

The legacy deterministic parser remains available as an explicit regression mode, including the proven `ACTOR WAIT ...` path.

## Timing contract

`NativeSceneTimelineCompiler` accepts explicit shot plans only. It enforces:

- at most 32 shots and 128 scheduled event references;
- finite non-negative starts and positive finite durations;
- exact start at 0 and contiguous shot boundaries (no gap/overlap);
- exact total scene-duration budget;
- known action IDs with no silently unscheduled action;
- camera focus bound to admitted exact source identity.

It never infers camera/timing semantics from prose late in rendering.

## Security/provenance invariants

- Original script is preserved and SHA-256 bound.
- Scene compilation binds exact BuildConfig source SHA and exact reference-image SHA-256.
- Script/reference/build edits invalidate the in-memory compiled plan and downstream export state.
- Arbitrary URL/file/shell/JavaScript directives are rejected as data-boundary violations.
- Model output has no direct filesystem/network/codec authority.
- Native Android CI scans source and the release APK for provider credential-like literals and for browser/WebView bytecode references.
- Existing H.264 MediaCodec Surface+EGL, Opus-only 48 kHz mono 96 kbps, bounded MP4 mux/interleave, durable save, saved SHA-256 and decoder-verification gates remain downstream and unchanged.

## Readiness truth

M57 is merge-ready only when the same final exact head has all required Foundation and Native Android CI green, compiler/security/benchmark gates green, exact-head APK provenance verified, and a real POCO X6 Pro 5G / Android 16 proof using that exact APK. A real Armenian 20–30 second script must visibly compile; unsupported parts must show fail-closed diagnostics, and an admitted natural-language subset must complete native H.264+Opus export plus on-phone playback verification.

No PR is merged as part of M57 verification without a separate explicit user instruction.
