# AI Animation Studio

A universal browser-first, local-first movie production system.

> **AI Animation Studio — universal browser application. Fully offline, local-first, no mandatory API, no subscription, no mandatory server, no APK, no mandatory discrete GPU.**

## Architecture constitution

1. Project State is the source of truth.
2. Pixels are outputs, not truth.
3. AI proposes; it never silently mutates canonical state.
4. Human locks always win.
5. Deterministic code is preferred for deterministic problems.
6. Character appearance, performance, camera, and lighting are independent layers.
7. Every expensive operation must be cacheable.
8. Cache must be disposable.
9. Story events produce explicit state transitions.
10. Definitions and runtime instances are separate.
11. Project formats must survive Studio upgrades through migrations.
12. Autonomous actions must be traceable and reversible.

## Foundation milestones

- **M0 — Movie State Engine:** stable IDs, rational time, canonical state, commands/events/reducers, persistence contracts.
- **M1 — Virtual Rehearsal:** proxy stage, actors, props, camera, paths, performance, IK/contact.
- **M2 — Media Production:** timeline, composition, media, audio, render/export.
- **M3 — Local AI Production:** local model runtime, generation adapters, vision QC, repair.

## Technology direction

- TypeScript: domain/application logic and browser orchestration
- Rust → WebAssembly: performance-critical deterministic kernels when benchmarks justify it
- WGSL/WebGPU: GPU rendering/compute
- SQLite-WASM + OPFS: live local workspace/index
- JSON/JSONL + binary assets: portable `.aistudio` Movie Source
- WebCodecs where supported, WASM fallback

The repository starts with **Foundation M0**. AI generation is deliberately not the first dependency; it will be added on top of a tested movie-state kernel.
