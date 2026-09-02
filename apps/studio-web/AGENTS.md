# AGENTS.md — Legacy Studio Web subtree

**Scope: `apps/studio-web/**`. Root `/AGENTS.md` and `/CANONICAL_MASTER_PLAN.md` remain authoritative.**

This subtree is **🗑️ as a production runtime**. It is historical compatibility/reference code.

Rules for any agent working here:

1. Do not turn Web/PWA/WebView back into the production architecture.
2. Do not create or advertise a Studio Web artifact as the canonical release candidate.
3. Browser-only failures do not block native Android production unless the active canonical phase explicitly depends on the reusable behavior being tested.
4. Prefer extracting reusable deterministic engine logic rather than extending browser-host architecture.
5. Do not add provider secrets, cloud lock-in, or a new competing roadmap.
6. If a requested change appears to revive this subtree as primary production code, stop and reconcile it with the root canonical plan first.
