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

**PHASE 7 — SCENE IR → FULL PRODUCTION ORCHESTRATION.**

Phase 6 is proven complete at the latest verified technical checkpoint:

- branch: `m58/native-3d-character-runtime`
- exact technical SHA: `79ca570b1796c43ec134599457051dbf9255c9b1`
- Phase 6 World Lighting CI #4: SUCCESS
- Foundation CI #358: SUCCESS
- Native Android CI #117: SUCCESS
- canonical semantic world anchors replace rehearsal anchors: SUCCESS
- accepted actor root tracks rebase to the canonical world path: SUCCESS
- RIGHT_HAND / PROP_GRASP contacts bind to the canonical prop anchor: SUCCESS
- deterministic prop ownership/state transitions: SUCCESS
- actor/camera collision clearance against canonical obstacles/props: SUCCESS
- accepted Virtual Director camera coverage rebased to canonical world state: SUCCESS
- deterministic key/fill/rim/environment lighting: SUCCESS
- bounded exposure + camera-aware subject visibility: SUCCESS
- deterministic world-bound actor + world/lighting replay: SUCCESS
- artifact: `studio-native-android-79ca570b1796c43ec134599457051dbf9255c9b1`
- artifact digest: `sha256:dc7151dfde9d74e99b20acf06b595e4ff6cbcc8ebc8403c93670c55e89a354c5`

Phase 6 does not claim automatic semantic-to-production orchestration. It proves that the accepted character/performance/camera layers can be resolved against one deterministic canonical world and lighting state.

Current Phase-7 objective is to connect the accepted M57 Scene/Story IR to the complete production stack so one natural-language scene automatically produces entities, state transitions, blocking, performances, canonical world/props, cameras, lighting, timeline and render jobs without developer-built internal JSON/state.

The exact branch/SHA/CI facts must always be re-verified live before work. Do not start Phase 8 until the Phase-7 DONE gate is proven.

## Historical architecture warning

This repository contains substantial historical browser/PWA/WebView code, tests, documents and milestones. They remain valuable as implementation history, compatibility evidence and reusable subsystem code, but they **do not define the final production runtime anymore**.

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
6. Character appearance, actor performance, camera, lighting and world state are explicit independent layers.
7. Every expensive operation should be cacheable where practical.
8. Cache is disposable and is not canonical state.
9. Story events produce explicit state transitions.
10. Definitions and runtime instances remain separate.
11. Project formats must survive Studio upgrades through migrations.
12. Autonomous actions must be traceable, validated and reversible where practical.

## Canonical references

- Repository execution plan: [`CANONICAL_MASTER_PLAN.md`](./CANONICAL_MASTER_PLAN.md)
- Repository agent contract: [`AGENTS.md`](./AGENTS.md)
- Persistent Google Drive plan mirror: https://docs.google.com/document/d/1fBywdZl3_D7YEGp76Eivb-zB2ACnmh77GO2KCf7uWpE/edit
- Research/benchmark library: https://drive.google.com/drive/folders/1aJihdEbWRN2s3nSQ4bmjBSr4FNKzi5nK

If historical documentation conflicts with the canonical plan, **the canonical plan governs product direction; live GitHub governs current branch/SHA/CI/code facts.**
