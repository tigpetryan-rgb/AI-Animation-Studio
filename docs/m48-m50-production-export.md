# HISTORICAL — M48–M50 browser export compatibility

> **SUPERSEDED PRODUCTION DIRECTION.** This document records browser-era M48–M50 implementation and validation evidence. It is retained for history and reusable media/export findings. It is **not** the current production release path or release gate. Current product direction is defined by `/CANONICAL_MASTER_PLAN.md` and is native Android.

Historical milestone record:

- **M48 — AAC compatibility path:** `media-export` added a fragmented H.264 + AAC-LC MP4 path (`mp4a.40.2`) alongside H.264 + Opus. Studio probed both encoders and preferred AAC when the browser/device could encode it, otherwise falling back to Opus.
- **M49 — disk capacity and recovery:** OPFS streaming estimated origin quota before large temporary exports, reserved output headroom, surfaced insufficient-space failures, and removed temporary partial files on cancellation/failure/finalization.
- **M50 — stress/browser gate:** multi-gigabyte planning remained bounded-memory and browser E2E tests covered cancellation, retry, download and playback.

These browser-specific gates no longer decide production readiness. Reusable codec, bounded-memory, persistence, checksum, cancellation and recovery lessons may be carried into the native pipeline when relevant.
