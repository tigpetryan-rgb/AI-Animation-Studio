# Development-only update signing — historical filename

`m55-update-debug.jks` is retained as a stable **development/CI update identity** so test APKs from different CI runs can update one another during device work.

The filename and alias are historical. They do **not** mean M55/WebView is the current runtime; canonical production architecture is native Android Compose.

This key must never be used as the final production/public release signing identity. Phase 11 final production signing requires a separate protected key outside the repository, with provenance recorded against the exact release artifact.
