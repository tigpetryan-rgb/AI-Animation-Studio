# M48–M50 production export compatibility

This milestone closes the remaining browser-native export gaps without silently claiming capabilities the active device does not have.

- **M48 — AAC compatibility path:** `media-export` now contains a fragmented H.264 + AAC-LC MP4 path (`mp4a.40.2`) alongside H.264 + Opus. Studio probes both encoders and Auto prefers AAC when the device can actually encode it, otherwise it falls back to Opus. Explicit AAC/Opus selection fails closed when unsupported.
- **M49 — disk capacity and recovery:** OPFS streaming estimates origin quota before opening a large temporary export, reserves output headroom, surfaces insufficient-space failures clearly, and removes temporary partial files on cancel/failure/finalization.
- **M50 — stress/release gate:** multi-gigabyte planning remains bounded-memory and the browser E2E gate continues to verify cancellation, retry, download and playback. AAC browser playback is gated by the device's native AAC encoder availability rather than assumed.

The browser-native path is still device-dependent. A device without native AAC uses H.264 + Opus. A future non-native AAC encoder/WASM fallback would be a separate compatibility layer, not a silent substitution.
