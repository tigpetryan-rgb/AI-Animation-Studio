# Վիդեոստուդիա — CANONICAL MASTER EXECUTION PLAN — v2

> **MANDATORY / DO NOT DEVIATE**
>
> This is the single repository-local canonical execution plan for AI Animation Studio («Վիդեոստուդիա»). Every new chat/agent must read `AGENTS.md` and this file before code, CI, release, branch, or architecture work.
>
> Persistent Drive mirror: https://docs.google.com/document/d/1fBywdZl3_D7YEGp76Eivb-zB2ACnmh77GO2KCf7uWpE/edit
>
> Research library: https://drive.google.com/drive/folders/1aJihdEbWRN2s3nSQ4bmjBSr4FNKzi5nK

## Status symbols

- ✅ completed, proven, retained
- ❌ not yet completed
- ⚠️ infrastructure exists but production-final acceptance is not proven
- 🗑️ no longer the main production direction; do not revive without explicit user decision and plan update

## 1. Authority and source-of-truth rules

1. This file controls execution order and product logic.
2. Live GitHub controls current branch/SHA/CI/code facts.
3. Drive Design Freeze / Project Continuity archives preserve historical architectural intent.
4. Old chat summaries never override live GitHub facts.
5. A new idea never overrides this plan unless the user explicitly changes the plan.
6. Major architecture changes require a plan update first, code second.
7. Do not create a competing master roadmap; update this plan in place and mirror it to Drive.
8. If GitHub and Drive disagree, report the contradiction and take the least-deviation safe action until reconciled.
9. Do not merge a PR without explicit user instruction.
10. Do not treat skipped CI as PASS, failed-CI artifacts as final, or emulator evidence as physical-device evidence.

## 2. Immutable product objective

The final product is a **native Android AI Animation Studio** that converts natural-language screenplay/scenario intent and reference material into canonical movie state, then uses deterministic production engines for character, performance, world, camera, lighting, timeline, rendering, audio/media, QC/repair, and final MP4 output.

Canonical production chain:

**Natural language / screenplay → semantic interpretation → strict Scene/Story IR → validation → canonical state → character/world → performance/blocking/IK → virtual director/camera/lighting → native render → audio/media → MP4 → QC/repair → physical-device verification.**

Architecture law:

**AI proposes. Engines execute. Validators verify. Canonical state decides. Human can override.**

External AI/provider-neutral semantic services may help interpret language, but provider secrets must never be packaged in the APK. AI output is candidate input, never canonical truth.

## 3. Removed primary directions

- 🗑️ Browser/PWA/WebKit/Chromium as final production runtime
- 🗑️ M55 WebView Controlled Runtime as final Android architecture
- 🗑️ PR #49 WebView line as production future
- 🗑️ large proprietary multilingual LLM packaged inside APK as the main semantic architecture
- 🗑️ Runway/PixVerse/other proprietary cloud generators as core runtime dependencies
- 🗑️ rewriting completed Foundation/Timeline/Persistence/Media layers without evidence
- 🗑️ browser-specific debugging as product blocker when native Android is unaffected

Historical browser code/tests may remain for compatibility and archaeology, but do not define the production architecture.

## 4. Completed and retained foundation

- ✅ Canonical project/movie/story/scene/shot/entity data model
- ✅ Stable IDs, Definition/Instance separation, hashed assets, candidate-vs-approved model
- ✅ RationalTime and exact timeline foundation
- ✅ Commands/history/undo-redo/snapshots/recovery-persistence foundation
- ✅ Workflow DAG/jobs/cache/scheduling/cancellation foundation
- ✅ Deterministic Film/Story compiler core layers
- ✅ Timeline/animation tracks/curves/deterministic evaluation foundation
- ✅ Media/video/audio/encoding/muxing/export foundation
- ✅ Packaging/provenance/checksum architecture
- ✅ M56 native Jetpack Compose runtime and native Android build/export foundation
- ✅ M57 multilingual natural-language → strict Scene IR baseline
- ✅ M58 real 3D mesh + humanoid rig + skinning foundation
- ✅ Phase 3 reusable `CharacterDefinition3D` / `CharacterAsset3D`, source-dependent multi-view geometry, UV/material regions, exact appearance ownership, checksummed save/reopen identity
- ✅ Phase 4 deterministic virtual actor: script-driven blocking/locomotion, turns/look, root motion, retargeting, contact constraints, layered acting, emotion/reaction, microperformance, deterministic reopen
- ✅ Phase 4 real-skinned-mesh continuity gate
- ✅ Phase 5 deterministic Virtual Director + Camera contract: one accepted Phase-4 master performance → multiple intent-selected cinematic shots with shot-size/lens language, movement, framing/visibility checks, collision clearance, eyeline continuity, and deterministic replay
- ✅ Latest Phase-5 technical checkpoint verifies native-only boundary, no packaged provider secret, APK existence/signature, embedded exact source SHA, browser-free bytecode, APK SHA-256 and provenance source/APK/signer bindings

## 5. Exists but is not production-final

- ⚠️ Final facial/finger visual fidelity beyond the Phase-4 acting contract remains later rendering/QC work.
- ⚠️ Phase-4 interactions and Phase-5 collision checks currently use explicit deterministic rehearsal target anchors; canonical world/prop anchors and full scene obstacles are Phase 6 scope.
- ⚠️ Lighting engine and cinematic scene setup.
- ⚠️ World/props/spatial-state production integration.
- ⚠️ Full Scene IR → character/performance/camera/lighting/timeline orchestration.
- ⚠️ Native real-time/offscreen render → encoder → final MP4 production chain.
- ⚠️ Deterministic QC + repair/self-healing on rendered scenes.
- ⚠️ Final Compose Studio workflow/UI.
- ⚠️ Final release artifact provenance/security audit. Phase-5 artifact is a strong checkpoint, not v1 final RC.

# 6. ACTIVE MASTER EXECUTION SEQUENCE

## PHASE 0 — PLAN FREEZE

✅ **COMPLETE.** Canonical plan exists in GitHub and Drive and is mandatory for all future work.

**DONE gate:** no parallel roadmap or architecture starts outside this plan. Proven.

## PHASE 1 — M57 GREEN BASELINE

✅ **COMPLETE.**

Initial verified baseline:
- branch: `m57/multilingual-scene-compiler`
- SHA: `a96d8ee2fc021b5e04558bd3e9a5f9ac30c0d2c8`
- Foundation CI #313: SUCCESS
- Native Android CI #74: SUCCESS

**DONE gate:** semantic benchmark + Foundation + Native Android green on the same exact SHA. Proven.

## PHASE 2 — MOVE M58 ONTO THE M57 GREEN BASE

✅ **COMPLETE.**

Verified checkpoint:
- branch: `m58/native-3d-character-runtime`
- SHA: `833883efec3d86014943f5e35ed92494462ec1d5`
- Foundation CI #320: SUCCESS
- Native Android CI #79: SUCCESS
- M57 300-case multilingual benchmark: SUCCESS
- M58 real 3D mesh/skinning gate: SUCCESS
- artifact: `studio-native-android-833883efec3d86014943f5e35ed92494462ec1d5`
- digest: `sha256:ccc875b6ccd432bf6ee36deabc1fb26ef61423a9cf271d24f86d2e4c7bf21768`

**DONE gate:** inherited M57 benchmark and real M58 mesh/skinning gate both RUN + PASS. Proven.

## PHASE 3 — CHARACTER RECONSTRUCTION / MODELING

✅ **COMPLETE.**

Verified technical checkpoint:
- branch: `m58/native-3d-character-runtime`
- SHA: `14ef943f32db2a6edce2cca50cc343b7bd8021c2`
- Phase 3 Character CI #6: SUCCESS
- Foundation CI #334: SUCCESS
- Native Android CI #93: SUCCESS
- real multi-view PNG reference-shape path: SUCCESS
- source-dependent silhouette geometry: SUCCESS
- real topology + humanoid skeleton mapping + skinning: SUCCESS
- UV + BODY/FACE/EYE/ACCENT material regions: SUCCESS
- exact reference appearance bytes owned by `CharacterDefinition3D`: SUCCESS
- reusable asset capture/instantiation + checksummed save/reopen identity: SUCCESS
- artifact: `studio-native-android-14ef943f32db2a6edce2cca50cc343b7bd8021c2`
- digest: `sha256:da52a0c002ab6d0017eb0b0c9953edb27fca47bb188275ac93c183debdaa8d63`

Acceptance is deterministic and measurable; it does not claim photogrammetric reconstruction. A later higher-fidelity backend may replace the shape builder without reopening the reusable identity/rig/skinning/persistence contract.

**DONE gate:** reference-derived 3D character preserves accepted source identity, has real rig/skinning, survives structural mesh validation, and reopens with the same validated identity/state. Proven.

## PHASE 4 — ACTOR PERFORMANCE ENGINE

✅ **COMPLETE.**

Verified technical checkpoint:
- branch: `m58/native-3d-character-runtime`
- SHA: `30b0186766b747f4844cba3f4fb91fea4e13349d`
- Phase 4 Actor Performance CI #4 attempt 2: SUCCESS
- Foundation CI #343: SUCCESS
- Native Android CI #102: SUCCESS
- walk → stop → turn/look → prop pickup/use → react: SUCCESS
- root motion + semantic retargeting: SUCCESS
- foot-lock/right-hand/prop-grasp contacts: SUCCESS
- body/head/face/gaze/hands/secondary layers: SUCCESS
- emotion/reaction + blink/breath/gaze/head-lead microperformance: SUCCESS
- deterministic reopen behavior: SUCCESS
- real skinned mesh finite/volumetric/bounded/continuous: SUCCESS
- artifact: `studio-native-android-30b0186766b747f4844cba3f4fb91fea4e13349d`
- digest: `sha256:1e72f9a010743f967c53d04a40ab967b428123c270f114ecc0e9644e090d5199`

The first Phase-4 CI #4 attempt was infrastructure-only Maven Central HTTP 429 before project/test execution; unchanged SHA attempt 2 passed. Phase-4 prop contacts use explicit deterministic rehearsal anchors; Phase 6 may replace them with canonical world anchors without reopening Phase 4.

**DONE gate:** required multi-step performance preserves root motion, retargeted layered acting, prop/foot contacts, reaction/emotion state and real-mesh continuity without technical collapse. Proven.

## PHASE 5 — VIRTUAL DIRECTOR + CAMERA

✅ **COMPLETE.**

Verified technical checkpoint:
- branch: `m58/native-3d-character-runtime`
- exact technical SHA: `2d9b4e4b38dd4c608a38b90062194f9b162cf61f`
- Phase 5 Virtual Director CI #1: SUCCESS
- Foundation CI #349: SUCCESS
- Native Android CI #108: SUCCESS
- same accepted Phase-4 master performance drives multiple deterministic camera shots: SUCCESS
- shot-size language: WIDE / FULL / MEDIUM / MEDIUM_CLOSE / CLOSE_UP: SUCCESS
- deterministic lens/FOV language using 35/40/50/55/65/85 mm choices: SUCCESS
- static / tracking / orbit / pan / dolly-in motion coverage: SUCCESS
- story/performance intent selection (locomotion / interaction / reaction): SUCCESS
- bounded subject framing and visibility samples: SUCCESS
- actor and explicit target-anchor collision-clearance gates: SUCCESS
- stable screen-side eyeline continuity: SUCCESS
- one-performance-many-cameras + deterministic identical replay: SUCCESS
- exact-head APK signature/source-SHA/browser-free/no-secret/provenance gates: SUCCESS
- artifact: `studio-native-android-2d9b4e4b38dd4c608a38b90062194f9b162cf61f`
- GitHub artifact digest: `sha256:dc277e24c5828d02d49f703a12fbc19432a9ad763e2b50e96986655abfdd8ba6`

Phase 5 intentionally does **not** claim full world collision or lighting integration. Current safety checks cover the actor and explicit Phase-4 rehearsal target anchors. Phase 6 supplies canonical environment/prop anchors, full spatial state and lighting constraints without reopening the Phase-5 camera-language/continuity contract.

**DONE gate:** the same master performance produces multiple logical, cinematic, continuity-safe shots with valid framing, lens/motion language, visibility, bounded collision clearance and stable eyeline continuity. Proven.

## PHASE 6 — LIGHTING + WORLD PRODUCTION

❌ **THIS IS THE CURRENT MANDATORY TECHNICAL PHASE.**

Connect locations/props/spatial state to the production scene.

Close:
- canonical semantic anchors
- world/actor/prop collisions
- prop ownership and state transitions
- environment layout
- deterministic reproduction of spatial state
- key/fill/rim/environment lighting
- exposure and subject visibility
- camera-aware lighting constraints
- replace Phase-4/5 rehearsal anchors with canonical world anchors where appropriate

**DONE gate:** actor + props + camera + lighting deterministically reproduce from the same canonical world state with valid interactions, collision safety and subject visibility.

## PHASE 7 — SCENE IR → FULL PRODUCTION ORCHESTRATION

❌ Connect M57 semantic output to the full production stack.

Scene/Story IR must produce entities, state transitions, blocking, performances, cameras, lighting, timeline and render jobs.

**DONE gate:** one natural-language scene reaches a validated production-ready timeline without manually constructing internal JSON/state.

## PHASE 8 — NATIVE RENDER + MEDIA PIPELINE

❌ Finish browser-free native render to production end-to-end quality.

Close real 3D frame rendering, exact frame timing, native/offscreen surface, safe hardware/software encoding, audio sync, muxing, cancellation, long-export safety and decoder-valid final MP4.

**DONE gate:** canonical timeline → standards-compatible MP4 with correct duration/frames/audio sync, successful decode-to-EOS verification and no browser/WebView dependency.

## PHASE 9 — QC + REPAIR / SELF-HEALING

❌ Deterministic quality gates on rendered scenes: character identity, pose/IK/contact, continuity, prop/world state, camera composition, lighting visibility, timing, media decode, A/V sync and artifact integrity.

Repair may fix only defined/reproducible issues and must leave provenance.

**DONE gate:** intentional failure fixtures are detected, supported failures are measurably repaired, unresolved critical QC can never pass final acceptance.

## PHASE 10 — FINAL STUDIO UI / WORKFLOW

❌ Final Compose workflow:

**project/reference import → screenplay/natural language → compile/diagnostics → character/world → rehearsal → camera/lighting preview → render → timeline/review → QC → export**

**DONE gate:** Golden Movie workflow can be completed from UI without developer-only canonical-state editing.

## PHASE 11 — BUILD / PROVENANCE / SECURITY GATES

❌ Bind every final RC to one exact source SHA: Foundation green, Native Android green, APK, valid signature, embedded SHA, checksum/provenance, extracted verification, browser-free runtime, no provider secret.

**DONE gate:** one final exact SHA → one proven APK/artifact provenance chain.

## PHASE 12 — PHYSICAL ANDROID CERTIFICATION

❌ Verify final APK on a real Android device. Primary target remains POCO X6 Pro 5G / Android 16 unless explicitly changed.

Mandatory: install/launch, open/save/reopen, reference import, semantic compile, preview/rehearsal, render/export, MP4 playback/decode, long task, cancellation and storage behavior.

**DONE gate:** physical-device evidence is bound to final exact SHA/APK; emulator/simulator evidence is insufficient.

## PHASE 13 — GOLDEN MOVIE ACCEPTANCE

❌ Final product-level acceptance using real reference character material and a real natural-language scenario including Armenian.

Pipeline:

**semantic compile → canonical scene → character → acting/performance → world/props → camera → lighting → render → audio/media → MP4 → QC → physical playback**

Must include at least one real character, full-body motion, gaze/expression/emotion, prop interaction, camera shot/movement, lighting, continuity, audio/dialogue path and final MP4.

**DONE gate:** film is meaningfully correct and watchable on the real target device and passes defined QC.

## PHASE 14 — CLEANUP + v1.0

❌ Only after Golden Movie: archive/deprecate obsolete WebView/browser production code/branches/docs, choose canonical native production branch, update release docs, preserve final artifacts/provenance, create v1.0 RC.

**DONE gate:** one understandable production branch, one documented build path, one canonical release artifact, no ambiguous runtime architecture.

# 7. RESEARCH LIBRARY RULE

Research Library: https://drive.google.com/drive/folders/1aJihdEbWRN2s3nSQ4bmjBSr4FNKzi5nK

This is a research/benchmark laboratory, not a dependency bundle. Use lawful clean-room study of Blender/Unreal/MediaPipe/DaVinci/After Effects/Godot/OpenToonz/Krita/ComfyUI/Runway/PixVerse/Ollama concepts only when the active phase needs them. Do not copy proprietary source/assets/code and do not wander away from the active DONE gate.

# 8. MANDATORY NEW-CHAT / AGENT INHERITANCE PROTOCOL

Every new chat/agent must:
1. read `AGENTS.md`;
2. read this plan;
3. read only relevant handoff/archive material;
4. re-check live branch head, exact 40-char SHA, CI, PR state and artifact provenance where relevant;
5. declare exactly one active phase and one concrete objective;
6. never open the next phase before the current DONE gate is evidence-proven;
7. never turn ⚠️ into ✅ merely because code exists;
8. never revive 🗑️ directions without explicit instruction and plan update;
9. if parallel chats are needed, assign non-overlapping subproblems, one integration owner and one exact base SHA;
10. only one code-writer changes overlapping code;
11. never merge a PR without explicit instruction;
12. prefer at most ~3 heavy debug/CI stages or ~20–25 heavy tool actions per chat;
13. end significant work with plan version, active phase, exact SHA, CI, artifact/evidence, changes, remaining work and exact next action;
14. archive important outcomes in Drive without creating a competing master plan.

# 9. LIVE CHECKPOINT RULE

Checkpoints never replace live verification.

- M57 baseline `a96d8ee2fc021b5e04558bd3e9a5f9ac30c0d2c8`: Foundation #313 SUCCESS; Native Android #74 SUCCESS.
- Phase 2 `833883efec3d86014943f5e35ed92494462ec1d5`: Foundation #320 SUCCESS; Native Android #79 SUCCESS; M57 benchmark + real M58 mesh/skinning SUCCESS.
- Phase 3 `14ef943f32db2a6edce2cca50cc343b7bd8021c2`: Phase 3 Character #6 SUCCESS; Foundation #334 SUCCESS; Native Android #93 SUCCESS.
- Phase 4 `30b0186766b747f4844cba3f4fb91fea4e13349d`: Phase 4 Actor Performance #4 attempt 2 SUCCESS; Foundation #343 SUCCESS; Native Android #102 SUCCESS.
- Phase 5 `2d9b4e4b38dd4c608a38b90062194f9b162cf61f`: Phase 5 Virtual Director #1 SUCCESS; Foundation #349 SUCCESS; Native Android #108 SUCCESS; artifact `studio-native-android-2d9b4e4b38dd4c608a38b90062194f9b162cf61f`; digest `sha256:dc277e24c5828d02d49f703a12fbc19432a9ad763e2b50e96986655abfdd8ba6`.

Therefore the active production action is **Phase 6 Lighting + World Production**.

# 10. GOLDEN MOVIE FINAL DEFINITION

The project is not v1.0-ready because tests pass or an APK exists. Final PASS exists only when **reference character + real natural-language scenario** passes the complete native production chain and produces a watchable final movie on a real target Android device.

Golden Movie simultaneously proves semantic understanding, character identity, acting, world interaction, camera language, lighting, timing, native render, media/export, QC/repair, persistence and physical-device usability.

# 11. PLAN CHANGE CONTROL

The plan may change only when:
A. the user explicitly changes product direction; or
B. live evidence proves architecture impossible/wrong; or
C. a phase completes and status/evidence must be updated.

When changing the plan, preserve history/rationale, update status/evidence, mirror GitHub + Drive in the same workstream, and do not begin code depending on the new direction before recording the change.

# 12. ONE-LINE CANONICAL PATH

**✅ Foundation → ✅ Native M56 → ✅ Semantic M57 → ✅ M58 green 3D → ✅ Character Modeling → ✅ Actor Performance → ✅ Virtual Director/Camera → ❌ Lighting/World → ❌ Full Orchestration → ❌ Native Render/Media → ❌ QC/Repair → ❌ Final Studio UI → ❌ Final Provenance/Security → ❌ Physical Android Certification → ❌ Golden Movie → ❌ v1.0**

# CURRENT NEXT ACTION

> ❌ **PHASE 6 — connect canonical locations, props and spatial state to the accepted actor-performance + Virtual Director stack: semantic anchors, collisions, prop ownership/state transitions, environment layout, key/fill/rim/environment lighting, exposure/visibility and camera-aware lighting constraints. Replace rehearsal anchors with canonical world anchors where appropriate. Do not open Phase 7 until actor + props + camera + lighting deterministically reproduce from the same canonical world state and the Phase-6 DONE gate is proven.**
