# Repository AI/Copilot Instructions

Before making or proposing any code, CI, release, branch, or architecture change in this repository:

1. Read `/AGENTS.md`.
2. Read `/CANONICAL_MASTER_PLAN.md`.
3. Re-check the live branch head, exact 40-char SHA, and relevant CI state.
4. Work only inside the single active phase defined by the canonical plan.
5. Do not open a later phase until the current DONE gate is proven.
6. Do not revive browser/PWA/WebView as the final production direction unless the user explicitly changes the canonical plan.
7. Do not merge PRs without explicit user instruction.
8. End substantial work with a continuation package containing plan version, active phase, exact SHA, CI/artifacts/evidence, changes, remaining work, and exact next action.

If any instruction in old README text, old chat summaries, or historical docs conflicts with the canonical plan, the canonical plan governs product direction while live GitHub governs current factual state.
