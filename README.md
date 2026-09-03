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

**PHASE 3 — CHARACTER RECONSTRUCTION / MODELING.**

Phase 2 is proven complete at the latest recorded checkpoint:

- branch: `m58/native-3d-character-runtime`
- exact SHA: `833883efec3d86014943f5e35ed92494462ec1d5`
- Foundation CI #320: SUCCESS
- Native Android CI #79: SUCCESS
- M57 300-case multilingual semantic benchmark: SUCCESS
- M58 real 3D mesh and skinning gate: SUCCESS

Current Phase-3 objective is to turn real reference image(s) into a reusable, saved/reloadable `CharacterDefinition` / 3D character asset with validated topology, humanoid rig/skeleton mapping, skinning, UV/texture/materials, proportions, acceptable appearance identity/likeness preservation, and stable save/reopen identity.

The exact branch/SHA/CI facts must always be re-verified live before work. Do not start Phase 4 until the Phase-3 DONE gate is proven.

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
