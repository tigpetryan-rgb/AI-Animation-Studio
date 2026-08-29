# Studio Web

This is the first runnable browser shell for AI Animation Studio.

It intentionally proves only the application-shell boundary:

- TypeScript/Vite browser bundle
- runtime capability probing
- deterministic Full Studio vs Compatibility Mode selection
- responsive Studio workspace shell
- PWA manifest and local-first Service Worker
- no cloud/API requirement

It does **not** claim representative-device WebGPU, WebCodecs, OPFS, Service Worker, media, model or performance verification. Those require browser/device smoke and benchmark stages after this build gate.
