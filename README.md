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

**PHASE 4 — ACTOR PERFORMANCE ENGINE.**

Phase 3 is proven complete at the latest recorded technical checkpoint:

- branch: `m58/native-3d-character-runtime`
- exact technical SHA: `14ef943f32db2a6edce2cca50cc343b7bd8021c2`
- Phase 3 Character CI #6: SUCCESS
- Foundation CI #334: SUCCESS
- Native Android CI #93: SUCCESS
- deterministic multi-view PNG reference geometry gate: SUCCESS
- reusable `CharacterDefinition3D` / `CharacterAsset3D`, humanoid rig/skinning, UV/material regions, source-dependent proportions and exact appearance ownership: SUCCESS
- checksummed save/reopen identity: SUCCESS
- artifact: `studio-native-android-14ef943f32db2a6edce2cca50cc343b7bd8021c2`
- artifact digest: `sha256:da52a0c002ab6d0017eb0b0c9953edb27fca47bb188275ac93c183debdaa8d63`

Current Phase-4 objective is to turn that reusable character into a deterministic virtual actor with blocking/locomotion, turns, root motion/retargeting, IK/foot lock/contact continuity, body/head/face/hands/gaze layers, prop interaction, emotion/reaction timing and acting-intent/microperformance hooks.

The exact branch/SHA/CI facts must always be re-verified live before work. Do not start Phase 5 until the Phase-4 DONE gate is proven.

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
