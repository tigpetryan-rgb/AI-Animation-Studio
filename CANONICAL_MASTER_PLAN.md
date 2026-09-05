# Վիդեոստուդիա — CANONICAL MASTER EXECUTION PLAN — v2

> **MANDATORY / DO NOT DEVIATE**
>
> This file is the repository-local canonical execution plan for AI Animation Studio («Վիդեոստուդիա»). Every new chat/agent must read `AGENTS.md` and this file **before** code changes, CI actions, branch changes, release work, or architectural decisions.
>
> Persistent Drive mirror: https://docs.google.com/document/d/1fBywdZl3_D7YEGp76Eivb-zB2ACnmh77GO2KCf7uWpE/edit
>
> Research library: https://drive.google.com/drive/folders/1aJihdEbWRN2s3nSQ4bmjBSr4FNKzi5nK

## Status symbols

- ✅ — completed, proven, and retained.
- ❌ — not yet completed.
- ⚠️ — code/infrastructure exists, but production-final acceptance is not proven.
- 🗑️ — no longer the main production direction; do not revive without explicit user decision and plan update.

## 1. Authority and source-of-truth rules

1. This file controls **execution order and product logic**.
2. Live GitHub controls current branch/SHA/CI/code facts.
3. Original Drive Design Freeze / Project Continuity archives control historical architectural intent summarized here.
4. Old chat summaries never override live GitHub facts.
5. A new idea never overrides this plan unless the user explicitly changes the canonical plan.
6. If a major architectural change is required, update this canonical plan first, then write code.
7. Do not create a competing master roadmap. Update this file in place and mirror the same approved change to the Drive canonical document.
8. If GitHub and Drive plan copies disagree, do not invent a third direction. Report the contradiction and use the least-deviation safe action until the mirrors are reconciled.

## 2. Immutable product objective

The final product is a **native Android AI Animation Studio** that converts natural-language screenplay/scenario intent and reference material into canonical movie state, then uses deterministic production engines to create characters, acting/performance, world state, camera, lighting, timeline, rendering, audio/media, QC/repair, and final MP4 output.

Canonical production chain:

**Natural language / screenplay → semantic interpretation → strict Scene/Story IR → validation → canonical state → character/world → performance/blocking/IK → virtual director/camera/lighting → native render → audio/media → MP4 → QC/repair → physical-device verification.**

Architecture law:

**AI proposes. Engines execute. Validators verify. Canonical state decides. Human can override.**

External AI/ChatGPT/provider-neutral semantic services may help interpret language, but provider secrets must never be packaged in the APK. AI output is candidate input, not canonical truth.

## 3. Removed primary directions

- 🗑️ Browser/PWA/WebKit/Chromium as the final production runtime.
- 🗑️ M55 WebView Controlled Runtime as the final Android architecture.
- 🗑️ PR #49 WebView line as the production future.
- 🗑️ Building a large proprietary multilingual LLM inside the APK as the main semantic architecture.
- 🗑️ Runway/PixVerse/other proprietary cloud generators as core runtime dependencies.
- 🗑️ Rewriting completed Foundation/Timeline/Persistence/Media layers without evidence that they are wrong.
- 🗑️ Browser-specific debugging as a product blocker when it does not affect the native Android path.

Historical browser code/tests may remain for compatibility, archaeology, or migration evidence, but they do not define current production architecture.

## 4. Completed and retained foundation

- ✅ Canonical project/movie/story/scene/shot/entity data model.
- ✅ Stable IDs, Definition/Instance separation, hashed assets, candidate-vs-approved model.
- ✅ RationalTime and exact timeline foundation.
- ✅ Commands, history, undo/redo, snapshots, recovery/persistence foundation.
- ✅ Workflow DAG, jobs, cache, scheduling, cancellation foundation.
- ✅ Deterministic Film/Story compiler core layers.
- ✅ Timeline/animation tracks, curves, deterministic evaluation foundation.
- ✅ Media pipeline foundation: video/audio handling, encoding, muxing, export infrastructure.
- ✅ Project packaging/provenance/checksum architecture and substantial implementation.
- ✅ M56 native Jetpack Compose runtime foundation.
- ✅ Native Android export/build foundation.
- ✅ M57 multilingual natural-language → strict Scene IR architecture.
- ✅ M57 verified green baseline with Foundation CI and Native Android CI green on the same exact SHA.
- ✅ M58 inherited M57 semantic benchmark is green on the verified M58 Phase-2 checkpoint.
- ✅ M58 real 3D mesh and skinning gate RUNS and PASSES on the verified Phase-2 checkpoint.
- ✅ Phase 3 reusable `CharacterDefinition3D` / `CharacterAsset3D`: source-dependent reference geometry, humanoid skeleton mapping, real skinning, UV/material regions, exact appearance bytes, checksummed save/reopen and fail-closed restore.
- ✅ Phase 3 deterministic PNG multi-view reconstruction gate proves different reference silhouettes produce measurably different 3D geometry rather than falling back to one generic scale.
- ✅ The latest Phase-3 technical checkpoint verifies native-only source boundary, no packaged provider secret, APK existence/signature, embedded exact source SHA, browser-free bytecode, APK SHA-256 and provenance source/APK/signer bindings.

## 5. Exists but is not production-final

- ⚠️ Face/expression/gaze/hands/fingers as performance layers beyond the retained Phase-3 character asset contract.
- ⚠️ Actor performance intelligence: blocking, pose, timing, emotion, subtext/microperformance.
- ⚠️ Motion retargeting, root motion, IK, foot lock, contacts, prop interaction.
- ⚠️ Camera engine: lens/framing/shot size/angle/movement/tracking/collision/continuity.
- ⚠️ Virtual Director: screenplay-driven camera/shot decisions.
- ⚠️ Lighting engine and cinematic scene setup.
- ⚠️ World/props/spatial state production integration.
- ⚠️ Full Scene IR → character/performance/camera/lighting/timeline orchestration.
- ⚠️ Native real-time/offscreen render → encoder → final MP4 production chain.
- ⚠️ Deterministic QC + repair/self-healing on real rendered scenes.
- ⚠️ Final Compose Studio workflow/UI.
- ⚠️ Final release artifact provenance/security audit. The Phase-3 artifact is a strong checkpoint, not the final v1 release candidate.

# 6. ACTIVE MASTER EXECUTION SEQUENCE

## PHASE 0 — PLAN FREEZE

✅ Canonical plan exists in GitHub and Drive and must be inherited by future chats/agents.

**DONE gate:** no parallel roadmap or architecture starts outside this plan.

## PHASE 1 — M57 GREEN BASELINE

✅ M57 semantic compiler reached a verified green baseline.

Initial verified baseline:
- branch: `m57/multilingual-scene-compiler`
- SHA: `a96d8ee2fc021b5e04558bd3e9a5f9ac30c0d2c8`
- Foundation CI #313: SUCCESS
- Native Android CI #74: SUCCESS

**DONE gate:** semantic benchmark + Foundation + Native Android gates green on the same exact SHA.

## PHASE 2 — MOVE M58 ONTO THE M57 GREEN BASE

✅ **COMPLETE.**

Verified Phase-2 checkpoint:
- branch: `m58/native-3d-character-runtime`
- exact SHA: `833883efec3d86014943f5e35ed92494462ec1d5`
- Foundation CI #320: SUCCESS
- Native Android CI #79: SUCCESS
- M57 300-case multilingual semantic benchmark: SUCCESS
- M58 real 3D mesh and skinning gate: SUCCESS
- Kotlin and Android verification: SUCCESS
- native APK signature/source-SHA/browser-free/no-secret checks: SUCCESS
- provenance source/APK/signer checks: SUCCESS
- artifact: `studio-native-android-833883efec3d86014943f5e35ed92494462ec1d5`
- GitHub artifact digest: `sha256:ccc875b6ccd432bf6ee36deabc1fb26ef61423a9cf271d24f86d2e4c7bf21768`

This supersedes the historical M58 #75/#77 failures and the earlier skipped 3D gate.

**DONE gate:** inherited M57 benchmark is green **and** M58 real 3D mesh/skinning gate actually RUNS and PASSES. Proven.

## PHASE 3 — CHARACTER RECONSTRUCTION / MODELING

✅ **COMPLETE.**

Verified Phase-3 technical checkpoint:
- branch: `m58/native-3d-character-runtime`
- exact technical SHA: `14ef943f32db2a6edce2cca50cc343b7bd8021c2`
- Phase 3 Character CI #6: SUCCESS
- Foundation CI #334: SUCCESS
- Native Android CI #93: SUCCESS
- real multi-view PNG reference-shape path: SUCCESS
- source-dependent silhouette geometry: SUCCESS; narrow/wide references produce measurably different 3D proportions
- real closed 3D topology + humanoid skeleton mapping + skinning: SUCCESS
- UV coordinates + BODY/FACE/EYE/ACCENT material regions: SUCCESS
- exact admitted reference appearance bytes owned by `CharacterDefinition3D`: SUCCESS
- reusable `CharacterAsset3D` capture/instantiation: SUCCESS
- checksummed save/reopen with exact mesh/rig/skinning/appearance identity: SUCCESS
- missing/tampered original reference restore fails closed or materializes exact owned reference bytes: SUCCESS
- native APK signature/source-SHA/browser-free/no-secret/provenance gates: SUCCESS
- artifact: `studio-native-android-14ef943f32db2a6edce2cca50cc343b7bd8021c2`
- GitHub artifact digest: `sha256:da52a0c002ab6d0017eb0b0c9953edb27fca47bb188275ac93c183debdaa8d63`

Phase-3 likeness acceptance is deliberately measurable and deterministic: the character asset owns the exact admitted appearance bytes and the multi-view reference silhouettes drive its 3D proportions. The implementation does **not** claim photogrammetric reconstruction; a future higher-fidelity reconstruction backend may replace the deterministic shape builder without reopening the Phase-3 reusable identity/rig/skinning/persistence contract.

**DONE gate:** a reference-derived 3D character preserves accepted source identity, has real rig/skinning, moves under the retained skinned-mesh validation without structural breakage, and reopens from persisted character definition with identical validated identity/state. Proven.

## PHASE 4 — ACTOR PERFORMANCE ENGINE

❌ **THIS IS THE CURRENT MANDATORY TECHNICAL PHASE.**

Turn the character into a virtual actor, not merely a moving mesh.

Close:
- blocking and locomotion
- turns
- body/head/face/hands/gaze layers
- root motion + retargeting
- IK + foot lock + contacts
- prop pickup/use
- emotion curves
- reaction timing
- acting intent + microperformance/subtext hooks

Performance sources may be library/captured/generated/manual, but canonical performance is normalized and validated by our engine.

**DONE gate:** actor completes a script-driven multi-step scene (walk, stop, look, interact with a prop, react, express emotion) while preserving contact and continuity without visible technical collapse.

## PHASE 5 — VIRTUAL DIRECTOR + CAMERA

❌ Build cinematic camera-language engine.

Close:
- shot sizes
- composition/framing
- lens/FOV
- angle
- camera zones
- static/dolly/pan/tilt/orbit/tracking motion
- subject visibility
- collision avoidance
- eyeline and shot continuity
- one-performance-many-cameras
- shot selection from story/performance intent

**DONE gate:** the same master performance can produce multiple logical, cinematic, continuity-safe shots without actor/world collision or broken framing.

## PHASE 6 — LIGHTING + WORLD PRODUCTION

❌ Connect locations/props/spatial state to production scene.

Close:
- semantic anchors
- collisions
- prop states
- environment layout
- key/fill/rim/environment lighting
- exposure/visibility
- camera-aware lighting constraints

**DONE gate:** actor + props + camera + lighting deterministically reproduce from the same canonical world state.

## PHASE 7 — SCENE IR → FULL PRODUCTION ORCHESTRATION

❌ Connect M57 semantic output to the full production stack.

Scene/Story IR must produce entities, state transitions, blocking, performances, cameras, lighting, timeline, and render jobs.

**DONE gate:** one natural-language scene reaches a validated production-ready timeline without manually constructing internal JSON/state.

## PHASE 8 — NATIVE RENDER + MEDIA PIPELINE

❌ Finish the browser-free native render path to production end-to-end quality.

Close:
- real 3D frame rendering
- exact frame timing
- native/offscreen surface
- safe hardware/software encoding path
- audio sync
- muxing
- cancellation
- long-export safety
- decoder-valid final MP4

**DONE gate:** canonical timeline → standards-compatible MP4 with correct duration/frames/audio sync, successful decode-to-EOS verification, and no browser/WebView dependency.

## PHASE 9 — QC + REPAIR / SELF-HEALING

❌ Run deterministic quality gates on real rendered production scenes.

QC domains:
- character identity
- pose/IK/contact
- continuity
- prop/world state
- camera visibility/composition
- lighting visibility
- timing
- media decode
- A/V sync
- artifact integrity

Repair may fix only defined/reproducible issues and must leave provenance.

**DONE gate:** intentional failure fixtures are detected, measurable repair fixes supported failures, and unresolved critical QC can never pass final build acceptance.

## PHASE 10 — FINAL STUDIO UI / WORKFLOW

❌ Make Compose UI the final user workflow.

User flow:

**project/reference import → screenplay/natural language → compile/diagnostics → character/world → rehearsal → camera/lighting preview → render → timeline/review → QC → export**

**DONE gate:** Golden Movie can be completed from UI without developer-only manual canonical-state editing.

## PHASE 11 — BUILD / PROVENANCE / SECURITY GATES

❌ Bind every final release candidate to one exact source SHA.

Mandatory:
- Foundation CI green
- Native Android CI green
- APK artifact exists
- signature valid
- exact source SHA embedded and verified
- checksum + provenance manifest verified
- extracted artifact verified
- browser-free runtime boundary verified
- provider secret absent

**DONE gate:** one final exact SHA → one proven APK/artifact provenance chain.

## PHASE 12 — PHYSICAL ANDROID CERTIFICATION

❌ Verify final APK on a real Android device. Primary target: POCO X6 Pro 5G / Android 16, unless the user explicitly changes the target device.

Mandatory physical checks:
- install/launch
- project open/save/reopen
- reference import
- semantic compile
- preview/rehearsal
- render/export
- MP4 playback/decode
- long-task stability
- cancellation
- storage behavior

**DONE gate:** physical-device evidence is bound to the final exact SHA/APK; emulator/simulator evidence is insufficient.

## PHASE 13 — GOLDEN MOVIE ACCEPTANCE

❌ Final product-level acceptance test.

Input:
- real reference character material
- a real natural-language scenario, including Armenian

Pipeline:

**semantic compile → canonical scene → character → acting/performance → world/props → camera → lighting → render → audio/media → MP4 → QC → physical playback**

Golden Movie must include at least:
- one real character
- full-body motion
- gaze/expression/emotion
- prop interaction
- camera shot/movement
- lighting
- continuity
- audio or dialogue path
- final MP4

**DONE gate:** the film not only compiles/exports but is meaningfully correct and watchable on the real target device and passes defined QC.

## PHASE 14 — CLEANUP + v1.0

❌ Only after Golden Movie.

Actions:
- explicitly archive/deprecate obsolete WebView/browser production code/branches/docs
- choose canonical native production branch
- update release documentation
- preserve final APK/artifacts/provenance
- create v1.0 release candidate

**DONE gate:** one understandable production branch, one documented build path, one canonical release artifact, no ambiguous runtime architecture.

# 7. RESEARCH LIBRARY RULE

Research Library: https://drive.google.com/drive/folders/1aJihdEbWRN2s3nSQ4bmjBSr4FNKzi5nK

This folder is a **research/benchmark laboratory**, not a dependency bundle.

- Blender → modeling, topology, rigging, skinning, materials, animation, camera.
- Unreal Engine → real-time scene, virtual production, character/camera/lighting workflows.
- MediaPipe → body/hand/face landmark/capture concepts.
- DaVinci Resolve / After Effects → editing, pacing, compositing, color, production conventions.
- Godot → scene graph/runtime ideas only when relevant to the active phase.
- OpenToonz/Krita → 2D/drawing/animation references only when in scope.
- ComfyUI → graph-based generation/workflow concepts.
- Runway/PixVerse → behavior/output benchmark, not core engine.
- Ollama/local-model material → historical/local-AI research, not mandatory production runtime.

**Clean-room rule:** study behavior, workflow, outputs, public architecture concepts, and lawful references; do not copy proprietary source/assets/code. Research opens only when the current active phase needs it. Do not wander into broad research that does not advance the active DONE gate.

# 8. MANDATORY NEW-CHAT / AGENT INHERITANCE PROTOCOL

Every new chat/agent must:

1. Read root `AGENTS.md`.
2. Read this `CANONICAL_MASTER_PLAN.md`.
3. Read only relevant archive/handoff material after the plan.
4. Re-check live GitHub branch head, exact 40-char SHA, CI, PR state, and artifact provenance when relevant.
5. Declare exactly **one active phase** and **one concrete next objective**.
6. Never open the next phase until the current phase DONE gate is proven by evidence.
7. Never change ⚠️ to ✅ merely because code exists.
8. Never revive 🗑️ directions without explicit user instruction and plan update.
9. If parallel chats are needed, assign non-overlapping subproblems, one integration owner, and one exact base SHA/active phase.
10. Only one code-writer may change overlapping code. Verifier/auditor roles do not write code unless explicitly assigned.
11. Never merge a PR without explicit user instruction.
12. Prefer at most ~3 heavy debug/CI stages or ~20–25 heavy tool actions per chat; when context becomes heavy, produce a continuation package and stop before losing coherence.
13. End every significant work chat with a continuation package containing: plan version, active phase, exact SHA, CI status, artifacts/evidence, what changed, what remains, exact next action.
14. Archive important chat outcomes in the project Drive archive, but do not create competing master plans.

# 9. LIVE CHECKPOINT RULE

The values below are checkpoints, not permission to skip live verification. **Every new chat must re-verify current branch/SHA/CI before relying on them.**

Historical M57 baseline:
- `a96d8ee2fc021b5e04558bd3e9a5f9ac30c0d2c8`
- Foundation CI #313: SUCCESS
- Native Android CI #74: SUCCESS

Historical M58 failure checkpoint retained for archaeology:
- `3ab5e0fa7dc3e672b1d630e55190ab74b2910b4b`
- Native Android CI #75: FAILURE in inherited M57 300-case semantic benchmark
- M58 real 3D mesh/skinning gate: SKIPPED

Superseding verified Phase-2 checkpoint:
- `833883efec3d86014943f5e35ed92494462ec1d5`
- Foundation CI #320: SUCCESS
- Native Android CI #79: SUCCESS
- M57 300-case benchmark: SUCCESS
- M58 real 3D mesh/skinning gate: SUCCESS
- exact-head APK/security/provenance checks: SUCCESS
- artifact: `studio-native-android-833883efec3d86014943f5e35ed92494462ec1d5`
- GitHub artifact digest: `sha256:ccc875b6ccd432bf6ee36deabc1fb26ef61423a9cf271d24f86d2e4c7bf21768`

Verified Phase-3 technical checkpoint:
- `14ef943f32db2a6edce2cca50cc343b7bd8021c2`
- Phase 3 Character CI #6: SUCCESS
- Foundation CI #334: SUCCESS
- Native Android CI #93: SUCCESS
- reference-driven multi-view geometry + reusable identity/persistence gate: SUCCESS
- exact-head APK/security/provenance checks: SUCCESS
- artifact: `studio-native-android-14ef943f32db2a6edce2cca50cc343b7bd8021c2`
- GitHub artifact digest: `sha256:da52a0c002ab6d0017eb0b0c9953edb27fca47bb188275ac93c183debdaa8d63`

Therefore the active production action is **Phase 4 Actor Performance Engine**.

# 10. GOLDEN MOVIE FINAL DEFINITION

The project is not v1.0-ready because unit tests pass, a build exists, or an APK exists.

Final PASS exists only when **reference character + real natural-language scenario** passes the complete native production chain and produces a watchable final movie on a real target Android device.

Golden Movie simultaneously proves:
- semantic understanding
- character identity
- acting/performance
- world interaction
- camera language
- lighting
- timing
- native render
- media/export
- QC/repair
- persistence
- physical-device usability

# 11. PLAN CHANGE CONTROL

The plan may change only when:

A. the user explicitly changes product direction; or
B. live technical evidence proves part of the architecture impossible/wrong; or
C. a phase completes and its status/evidence must be updated.

When changing the plan:
1. preserve history/rationale;
2. update status/evidence;
3. update this GitHub plan and the Drive canonical mirror in the same workstream;
4. do not begin code that depends on the new direction until the plan change is recorded.

# 12. ONE-LINE CANONICAL PATH

**✅ Foundation → ✅ Native M56 → ✅ Semantic M57 → ✅ M58 green 3D → ✅ Character Modeling → ❌ Actor Performance → ❌ Virtual Director/Camera → ❌ Lighting/World → ❌ Full Orchestration → ❌ Native Render/Media → ❌ QC/Repair → ❌ Final Studio UI → ❌ Final Provenance/Security → ❌ Physical Android Certification → ❌ Golden Movie → ❌ v1.0**

# CURRENT NEXT ACTION

> ❌ **PHASE 4 — turn the reusable Phase-3 character into a virtual actor that can execute a script-driven multi-step performance: walk, stop, turn/look, interact with a prop, react, express emotion, while preserving root motion, retargeting, IK/foot lock/contact continuity, gaze/face/hands layers and deterministic canonical performance state. Do not open Phase 5 until this DONE gate is proven.**
