# Legacy Studio Web — Historical Compatibility Surface

> **🗑️ NOT THE PRODUCTION RUNTIME.**
>
> This subtree is retained for historical browser/PWA compatibility evidence, reusable deterministic logic, migration archaeology, and explicitly requested compatibility work. The canonical production runtime is **native Android Jetpack Compose**. Read `/AGENTS.md` and `/CANONICAL_MASTER_PLAN.md` before changing this subtree.

## Allowed uses

- reproduce historical browser milestones and compatibility evidence;
- preserve or test reusable deterministic timeline/media/state logic;
- extract/port useful engine concepts into the native production stack;
- investigate browser behavior only when the active canonical phase explicitly needs it.

## Not allowed without a canonical-plan change

- treating Studio Web/PWA/WebView as the final production runtime;
- creating a production release candidate from this subtree;
- blocking native Android progress on a browser-only failure;
- adding new production architecture here instead of the native Android stack;
- reviving M55 WebView/PWA direction because historical code already exists.

The old browser shell includes TypeScript/Vite, capability probing, PWA/service-worker behavior, media/export experiments, persistence and device/browser diagnostics. Those artifacts are historical/compatibility surfaces, not the current product release path.
