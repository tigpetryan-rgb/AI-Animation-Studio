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

**PHASE 8 — NATIVE RENDER + MEDIA PIPELINE.**

Phase 7 is proven complete at the latest verified technical checkpoint:

- branch: `m58/native-3d-character-runtime`
- exact technical SHA: `7f64b6e9938527e08d766172df6234a0506eff89`
- Phase 7 Production Orchestration CI #1: SUCCESS
- Foundation CI #364: SUCCESS
- Native Android CI #123: SUCCESS
- Armenian natural-language entry through the semantic compiler: SUCCESS
- canonical entity/state resolution: SUCCESS
- direct Scene IR → accepted character/performance/camera/world/lighting contracts: SUCCESS
- no legacy Scene-IR-to-text production detour: SUCCESS
- canonical world-bound actor contacts + prop ownership/state: SUCCESS
- semantic camera/lighting/environment controls: SUCCESS
- exact 168-frame contiguous production timeline for 14 s @ 12 fps: SUCCESS
- identity-bound deterministic render-job DAG: SUCCESS
- artifact: `studio-native-android-7f64b6e9938527e08d766172df6234a0506eff89`
- artifact digest: `sha256:7711345bf9f9f85b533a2b6da61e472ae3abb0e656e4fd3ef19b6e80206f978d`

Phase 7 stops at a validated canonical timeline and render-job graph. It does not claim final media production.

Current Phase-8 objective is to consume that accepted timeline/job graph and produce real browser-free native frames and a standards-compatible MP4 with exact frame timing/count, safe native/offscreen rendering and encoding, synchronized audio, muxing, cancellation/long-export safety, decode-to-EOS verification and exact media provenance.

The exact branch/SHA/CI facts must always be re-verified live before work. Do not start Phase 9 until the Phase-8 DONE gate is proven.

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
