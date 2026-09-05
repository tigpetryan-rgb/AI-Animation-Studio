# AI Animation Studio / «Վիդեոստուդիա»

> ## ⛔ MANDATORY BEFORE ANY WORK
>
> Every new chat/agent/coding session must first read:
>
> 1. **[`AGENTS.md`](./AGENTS.md)** — mandatory operating contract
> 2. **[`CANONICAL_MASTER_PLAN.md`](./CANONICAL_MASTER_PLAN.md)** — single canonical execution plan
>
> Do **not** make code, CI, branch, release, or architecture decisions before reading them.

## Current production direction

The canonical production direction is **native Android AI Animation Studio**.

Canonical chain:

**Natural language / screenplay → semantic interpretation → strict Scene/Story IR → validation → canonical state → character/world → actor performance/blocking/IK → virtual director/camera/lighting → native render → audio/media → MP4 → QC/repair → physical-device verification.**

Core law:

> **AI proposes. Engines execute. Validators verify. Canonical state decides. Human can override.**

## Current mandatory phase

**PHASE 5 — VIRTUAL DIRECTOR + CAMERA.**

Phase 4 is proven complete at the latest verified technical checkpoint:

- branch: `m58/native-3d-character-runtime`
- exact technical SHA: `30b0186766b747f4844cba3f4fb91fea4e13349d`
- Phase 4 Actor Performance CI #4 attempt 2: SUCCESS
- Foundation CI #343: SUCCESS
- Native Android CI #102: SUCCESS
- deterministic script-driven walk → stop → turn/look → prop pickup/use → react performance: SUCCESS
- root motion + semantic retargeting + foot-lock/contact/grasp continuity: SUCCESS
- body/head/face/hands/gaze + emotion/reaction/microperformance layers: SUCCESS
- deterministic reopen continuity: SUCCESS
- real Phase-3 skinned-mesh deformation continuity gate: SUCCESS
- artifact: `studio-native-android-30b0186766b747f4844cba3f4fb91fea4e13349d`
- artifact digest: `sha256:1e72f9a010743f967c53d04a40ab967b428123c270f114ecc0e9644e090d5199`

Current Phase-5 objective is to build a deterministic virtual director and cinematic camera-language engine: shot sizes, composition/framing, lens/FOV, angle, camera zones, static/dolly/pan/tilt/orbit/tracking motion, subject visibility, collision avoidance, eyeline/continuity, one-performance-many-cameras, and shot selection from story/performance intent.

The exact branch/SHA/CI facts must always be re-verified live before work. Do not start Phase 6 until the Phase-5 DONE gate is proven.

## Historical architecture warning

This repository contains substantial historical browser/PWA/WebView code, tests, documents, and milestones. They remain valuable as implementation history, compatibility evidence, and reusable subsystem code, but they **do not define the final production runtime anymore**.

The following are no longer primary production directions unless the user explicitly changes the canonical plan:

- Browser/PWA/WebKit/Chromium as final runtime
- M55 WebView Controlled Runtime as final Android architecture
- PR #49 WebView line as production future
- a large multilingual LLM packaged inside the APK as the primary semantic architecture
- Runway/PixVerse/other proprietary cloud generators as core runtime dependencies

## Architecture constitution retained from the original Design Freeze

1. Canonical Project State is the source of truth.
2. Pixels are outputs, not truth.
3. AI proposes; it never silently mutates canonical state.
4. Human locks always win.
5. Deterministic code is preferred for deterministic problems.
6. Character appearance, actor performance, camera, lighting, and world state are explicit independent layers.
7. Every expensive operation should be cacheable where practical.
8. Cache is disposable and is not canonical state.
9. Story events produce explicit state transitions.
10. Definitions and runtime instances remain separate.
11. Project formats must survive Studio upgrades through migrations.
12. Autonomous actions must be traceable, validated, and reversible where practical.

## Canonical references

- Repository execution plan: [`CANONICAL_MASTER_PLAN.md`](./CANONICAL_MASTER_PLAN.md)
- Repository agent contract: [`AGENTS.md`](./AGENTS.md)
- Persistent Google Drive plan mirror: https://docs.google.com/document/d/1fBywdZl3_D7YEGp76Eivb-zB2ACnmh77GO2KCf7uWpE/edit
- Research/benchmark library: https://drive.google.com/drive/folders/1aJihdEbWRN2s3nSQ4bmjBSr4FNKzi5nK

If historical documentation conflicts with the canonical plan, **the canonical plan governs product direction; live GitHub governs current branch/SHA/CI/code facts.**
