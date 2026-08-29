export const WEBM_MIME_TYPE = "video/webm;codecs=vp8" as const;
export const WEBM_CODEC = "vp8" as const;
export const WEBM_TIMECODE_SCALE_NS = 1_000_000 as const;

export type MediaExportErrorCode =
  | "MEDIA_EXPORT_INVALID_CONFIG"
  | "MEDIA_EXPORT_WEBCODECS_UNAVAILABLE"
  | "MEDIA_EXPORT_CODEC_UNSUPPORTED"
  | "MEDIA_EXPORT_ENCODER_FAILED"
  | "MEDIA_EXPORT_INVALID_CHUNK";

export class MediaExportError extends Error {
  readonly code: MediaExportErrorCode;

  constructor(code: MediaExportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MediaExportError";
    this.code = code;
  }
}

export interface Vp8MuxChunk {
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly key: boolean;
  readonly data: Uint8Array;
}

export interface Vp8WebMExportOptions {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly frameCount: number;
  readonly bitrate?: number;
  readonly keyFrameIntervalFrames?: number;
  readonly createFrame: (
    frameIndex: number,
    timestampUs: number,
    durationUs: number,
  ) => VideoFrame | Promise<VideoFrame>;
}

export interface Vp8WebMExportResult {
  readonly bytes: Uint8Array;
  readonly mimeType: typeof WEBM_MIME_TYPE;
  readonly codec: typeof WEBM_CODEC;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly frameCount: number;
  readonly durationUs: number;
  readonly encodedChunks: number;
}

const encoder = new TextEncoder();

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function idBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`Invalid EBML id ${hex}.`);
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function encodeVintSize(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MediaExportError("MEDIA_EXPORT_INVALID_CHUNK", `Invalid EBML size ${value}.`);
  }
  for (let width = 1; width <= 8; width += 1) {
    const max = 2 ** (7 * width) - 2;
    if (value <= max) {
      const bytes = new Uint8Array(width);
      let remaining = value;
      for (let index = width - 1; index >= 0; index -= 1) {
        bytes[index] = remaining & 0xff;
        remaining = Math.floor(remaining / 256);
      }
      bytes[0] = (bytes[0] ?? 0) | (1 << (8 - width));
      return bytes;
    }
  }
  throw new MediaExportError("MEDIA_EXPORT_INVALID_CHUNK", "EBML element exceeds supported size.");
}

function element(id: string, payload: Uint8Array): Uint8Array {
  return concatBytes([idBytes(id), encodeVintSize(payload.byteLength), payload]);
}

function master(id: string, children: readonly Uint8Array[]): Uint8Array {
  return element(id, concatBytes(children));
}

function unsignedBytes(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MediaExportError("MEDIA_EXPORT_INVALID_CHUNK", `Invalid unsigned EBML value ${value}.`);
  }
  if (value === 0) return new Uint8Array([0]);
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return new Uint8Array(bytes);
}

function uintElement(id: string, value: number): Uint8Array {
  return element(id, unsignedBytes(value));
}

function stringElement(id: string, value: string): Uint8Array {
  return element(id, encoder.encode(value));
}

function float64Element(id: string, value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return element(id, bytes);
}

function int16Bytes(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < -32_768 || value > 32_767) {
    throw new MediaExportError("MEDIA_EXPORT_INVALID_CHUNK", `Invalid SimpleBlock timecode ${value}.`);
  }
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setInt16(0, value, false);
  return bytes;
}

function simpleBlock(chunk: Vp8MuxChunk, relativeMs: number): Uint8Array {
  if (chunk.data.byteLength === 0) {
    throw new MediaExportError("MEDIA_EXPORT_INVALID_CHUNK", "Encoded VP8 chunk must not be empty.");
  }
  const flags = chunk.key ? 0x80 : 0x00;
  return element("A3", concatBytes([
    new Uint8Array([0x81]),
    int16Bytes(relativeMs),
    new Uint8Array([flags]),
    chunk.data,
  ]));
}

function makeEbmlHeader(): Uint8Array {
  return master("1A45DFA3", [
    uintElement("4286", 1),
    uintElement("42F7", 1),
    uintElement("42F2", 4),
    uintElement("42F3", 8),
    stringElement("4282", "webm"),
    uintElement("4287", 4),
    uintElement("4285", 2),
  ]);
}

function makeInfo(durationMs: number): Uint8Array {
  return master("1549A966", [
    uintElement("2AD7B1", WEBM_TIMECODE_SCALE_NS),
    float64Element("4489", durationMs),
    stringElement("4D80", "AI Animation Studio"),
    stringElement("5741", "AI Animation Studio"),
  ]);
}

function makeTracks(width: number, height: number): Uint8Array {
  return master("1654AE6B", [
    master("AE", [
      uintElement("D7", 1),
      uintElement("73C5", 1),
      uintElement("83", 1),
      stringElement("86", "V_VP8"),
      master("E0", [
        uintElement("B0", width),
        uintElement("BA", height),
      ]),
    ]),
  ]);
}

function makeClusters(chunks: readonly Vp8MuxChunk[]): Uint8Array[] {
  const clusters: Uint8Array[] = [];
  let clusterStartMs: number | null = null;
  let blocks: Uint8Array[] = [];

  const flush = (): void => {
    if (clusterStartMs === null || blocks.length === 0) return;
    clusters.push(master("1F43B675", [uintElement("E7", clusterStartMs), ...blocks]));
    clusterStartMs = null;
    blocks = [];
  };

  for (const chunk of chunks) {
    if (!Number.isSafeInteger(chunk.timestampUs) || chunk.timestampUs < 0) {
      throw new MediaExportError("MEDIA_EXPORT_INVALID_CHUNK", "VP8 chunk timestamp must be a non-negative integer in microseconds.");
    }
    if (!Number.isSafeInteger(chunk.durationUs) || chunk.durationUs <= 0) {
      throw new MediaExportError("MEDIA_EXPORT_INVALID_CHUNK", "VP8 chunk duration must be a positive integer in microseconds.");
    }

    const timeMs = Math.round(chunk.timestampUs / 1000);
    if (clusterStartMs === null) clusterStartMs = timeMs;
    let relativeMs = timeMs - clusterStartMs;
    if (relativeMs > 30_000 || relativeMs > 32_767) {
      flush();
      clusterStartMs = timeMs;
      relativeMs = 0;
    }
    blocks.push(simpleBlock(chunk, relativeMs));
  }
  flush();
  return clusters;
}

export function muxVp8WebM(
  width: number,
  height: number,
  frameRate: number,
  chunks: readonly Vp8MuxChunk[],
): Uint8Array {
  validateDimensions(width, height, frameRate);
  if (chunks.length === 0) {
    throw new MediaExportError("MEDIA_EXPORT_INVALID_CHUNK", "At least one encoded VP8 chunk is required.");
  }

  const last = chunks[chunks.length - 1];
  if (last === undefined) {
    throw new MediaExportError("MEDIA_EXPORT_INVALID_CHUNK", "At least one encoded VP8 chunk is required.");
  }
  const durationUs = last.timestampUs + last.durationUs;
  const segment = master("18538067", [
    makeInfo(durationUs / 1000),
    makeTracks(width, height),
    ...makeClusters(chunks),
  ]);
  return concatBytes([makeEbmlHeader(), segment]);
}

function validateDimensions(width: number, height: number, frameRate: number): void {
  if (
    !Number.isInteger(width) || width <= 0 || width > 16_384
    || !Number.isInteger(height) || height <= 0 || height > 16_384
    || !Number.isFinite(frameRate) || frameRate <= 0 || frameRate > 240
  ) {
    throw new MediaExportError(
      "MEDIA_EXPORT_INVALID_CONFIG",
      `Invalid video config ${width}x${height} @ ${frameRate} fps.`,
    );
  }
}

function validateExportOptions(options: Vp8WebMExportOptions): void {
  validateDimensions(options.width, options.height, options.frameRate);
  if (!Number.isInteger(options.frameCount) || options.frameCount <= 0 || options.frameCount > 1_000_000) {
    throw new MediaExportError("MEDIA_EXPORT_INVALID_CONFIG", `Invalid frame count ${options.frameCount}.`);
  }
  if (options.bitrate !== undefined && (!Number.isInteger(options.bitrate) || options.bitrate <= 0)) {
    throw new MediaExportError("MEDIA_EXPORT_INVALID_CONFIG", `Invalid bitrate ${options.bitrate}.`);
  }
  if (
    options.keyFrameIntervalFrames !== undefined
    && (!Number.isInteger(options.keyFrameIntervalFrames) || options.keyFrameIntervalFrames <= 0)
  ) {
    throw new MediaExportError(
      "MEDIA_EXPORT_INVALID_CONFIG",
      `Invalid key-frame interval ${options.keyFrameIntervalFrames}.`,
    );
  }
}

export async function exportVp8WebM(options: Vp8WebMExportOptions): Promise<Vp8WebMExportResult> {
  validateExportOptions(options);
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    throw new MediaExportError(
      "MEDIA_EXPORT_WEBCODECS_UNAVAILABLE",
      "WebCodecs VideoEncoder/VideoFrame is unavailable in this browser.",
    );
  }

  const bitrate = options.bitrate ?? Math.max(250_000, Math.round(options.width * options.height * options.frameRate * 0.08));
  const config: VideoEncoderConfig = {
    codec: WEBM_CODEC,
    width: options.width,
    height: options.height,
    bitrate,
    framerate: options.frameRate,
    latencyMode: "quality",
  };
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) {
    throw new MediaExportError(
      "MEDIA_EXPORT_CODEC_UNSUPPORTED",
      `Browser does not support VP8 encoding for ${options.width}x${options.height} @ ${options.frameRate} fps.`,
    );
  }

  const chunks: Vp8MuxChunk[] = [];
  let encoderFailure: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({
        timestampUs: chunk.timestamp,
        durationUs: chunk.duration ?? Math.max(1, Math.round(1_000_000 / options.frameRate)),
        key: chunk.type === "key",
        data,
      });
    },
    error: (error) => {
      encoderFailure = error;
    },
  });

  const frameDurationUs = Math.max(1, Math.round(1_000_000 / options.frameRate));
  const keyFrameInterval = options.keyFrameIntervalFrames ?? Math.max(1, Math.round(options.frameRate * 2));
  try {
    videoEncoder.configure(support.config ?? config);
    for (let frameIndex = 0; frameIndex < options.frameCount; frameIndex += 1) {
      const timestampUs = frameIndex * frameDurationUs;
      const frame = await options.createFrame(frameIndex, timestampUs, frameDurationUs);
      try {
        videoEncoder.encode(frame, { keyFrame: frameIndex === 0 || frameIndex % keyFrameInterval === 0 });
      } finally {
        frame.close();
      }
      if (videoEncoder.encodeQueueSize > 8) await videoEncoder.flush();
      if (encoderFailure !== null) throw encoderFailure;
    }
    await videoEncoder.flush();
  } catch (error) {
    throw new MediaExportError(
      "MEDIA_EXPORT_ENCODER_FAILED",
      error instanceof Error ? error.message : "VP8 encoder failed.",
      error instanceof Error ? { cause: error } : undefined,
    );
  } finally {
    videoEncoder.close();
  }

  const finalEncoderFailure = encoderFailure as Error | null;
  if (finalEncoderFailure !== null) {
    throw new MediaExportError("MEDIA_EXPORT_ENCODER_FAILED", finalEncoderFailure.message, { cause: finalEncoderFailure });
  }
  if (chunks.length === 0) {
    throw new MediaExportError("MEDIA_EXPORT_ENCODER_FAILED", "VP8 encoder produced no chunks.");
  }
  chunks.sort((left, right) => left.timestampUs - right.timestampUs);
  const durationUs = options.frameCount * frameDurationUs;
  return {
    bytes: muxVp8WebM(options.width, options.height, options.frameRate, chunks),
    mimeType: WEBM_MIME_TYPE,
    codec: WEBM_CODEC,
    width: options.width,
    height: options.height,
    frameRate: options.frameRate,
    frameCount: options.frameCount,
    durationUs,
    encodedChunks: chunks.length,
  };
}

export function hasWebMHeader(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4
    && bytes[0] === 0x1a
    && bytes[1] === 0x45
    && bytes[2] === 0xdf
    && bytes[3] === 0xa3;
}
