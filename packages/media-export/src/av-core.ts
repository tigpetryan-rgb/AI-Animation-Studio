export const AV_WEBM_MIME_TYPE = "video/webm;codecs=vp8,opus" as const;
export const AV_VIDEO_CODEC = "vp8" as const;
export const AV_AUDIO_CODEC = "opus" as const;
export const AV_OPUS_SAMPLE_RATE = 48_000 as const;
export const AV_WEBM_TIMECODE_SCALE_NS = 1_000_000 as const;

const DEFAULT_AUDIO_CHUNK_FRAMES = 960;
const MAX_CLUSTER_SPAN_MS = 30_000;

export type AvExportErrorCode =
  | "AV_EXPORT_INVALID_CONFIG"
  | "AV_EXPORT_WEBCODECS_UNAVAILABLE"
  | "AV_EXPORT_VIDEO_CODEC_UNSUPPORTED"
  | "AV_EXPORT_AUDIO_CODEC_UNSUPPORTED"
  | "AV_EXPORT_VIDEO_ENCODER_FAILED"
  | "AV_EXPORT_AUDIO_ENCODER_FAILED"
  | "AV_EXPORT_INVALID_VIDEO_FRAME"
  | "AV_EXPORT_INVALID_AUDIO_DATA"
  | "AV_EXPORT_INVALID_CHUNK";

export class AvExportError extends Error {
  readonly code: AvExportErrorCode;

  constructor(code: AvExportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AvExportError";
    this.code = code;
  }
}

export interface AvVp8MuxChunk {
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly key: boolean;
  readonly data: Uint8Array;
}

export interface AvOpusMuxChunk {
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly data: Uint8Array;
}

export interface Vp8OpusWebMExportOptions {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly frameCount: number;
  readonly videoBitrate?: number;
  readonly keyFrameIntervalFrames?: number;
  readonly createFrame: (
    frameIndex: number,
    timestampUs: number,
    durationUs: number,
  ) => VideoFrame | Promise<VideoFrame>;

  readonly numberOfChannels: 1 | 2;
  readonly totalAudioFrames: number;
  readonly audioChunkFrames?: number;
  readonly audioBitrate?: number;
  readonly createAudioData: (
    startFrame: number,
    frameCount: number,
    timestampUs: number,
  ) => AudioData | Promise<AudioData>;
}

export interface Vp8OpusWebMExportResult {
  readonly bytes: Uint8Array;
  readonly mimeType: typeof AV_WEBM_MIME_TYPE;
  readonly videoCodec: typeof AV_VIDEO_CODEC;
  readonly audioCodec: typeof AV_AUDIO_CODEC;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly frameCount: number;
  readonly sampleRate: typeof AV_OPUS_SAMPLE_RATE;
  readonly numberOfChannels: 1 | 2;
  readonly totalAudioFrames: number;
  readonly durationUs: number;
  readonly encodedVideoChunks: number;
  readonly encodedAudioChunks: number;
}

const utf8 = new TextEncoder();

function concat(parts: readonly Uint8Array[]): Uint8Array {
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

function id(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new AvExportError("AV_EXPORT_INVALID_CHUNK", `Invalid EBML id ${hex}.`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function vint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AvExportError("AV_EXPORT_INVALID_CHUNK", `Invalid EBML size ${value}.`);
  }
  for (let width = 1; width <= 8; width += 1) {
    if (value <= 2 ** (7 * width) - 2) {
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
  throw new AvExportError("AV_EXPORT_INVALID_CHUNK", "EBML element is too large.");
}

function element(elementId: string, payload: Uint8Array): Uint8Array {
  return concat([id(elementId), vint(payload.byteLength), payload]);
}

function master(elementId: string, children: readonly Uint8Array[]): Uint8Array {
  return element(elementId, concat(children));
}

function unsigned(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AvExportError("AV_EXPORT_INVALID_CHUNK", `Invalid EBML integer ${value}.`);
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

function uint(elementId: string, value: number): Uint8Array {
  return element(elementId, unsigned(value));
}

function stringElement(elementId: string, value: string): Uint8Array {
  return element(elementId, utf8.encode(value));
}

function float64(elementId: string, value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return element(elementId, bytes);
}

function signed16(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < -32_768 || value > 32_767) {
    throw new AvExportError("AV_EXPORT_INVALID_CHUNK", `Invalid SimpleBlock timecode ${value}.`);
  }
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setInt16(0, value, false);
  return bytes;
}

function createOpusHead(channels: 1 | 2): Uint8Array {
  const bytes = new Uint8Array(19);
  bytes.set(utf8.encode("OpusHead"), 0);
  bytes[8] = 1;
  bytes[9] = channels;
  const view = new DataView(bytes.buffer);
  view.setUint16(10, 312, true);
  view.setUint32(12, AV_OPUS_SAMPLE_RATE, true);
  view.setInt16(16, 0, true);
  bytes[18] = 0;
  return bytes;
}

function ebmlHeader(): Uint8Array {
  return master("1A45DFA3", [
    uint("4286", 1),
    uint("42F7", 1),
    uint("42F2", 4),
    uint("42F3", 8),
    stringElement("4282", "webm"),
    uint("4287", 4),
    uint("4285", 2),
  ]);
}

function info(durationMs: number): Uint8Array {
  return master("1549A966", [
    uint("2AD7B1", AV_WEBM_TIMECODE_SCALE_NS),
    float64("4489", durationMs),
    stringElement("4D80", "AI Animation Studio"),
    stringElement("5741", "AI Animation Studio"),
  ]);
}

function tracks(width: number, height: number, channels: 1 | 2): Uint8Array {
  const videoTrack = master("AE", [
    uint("D7", 1),
    uint("73C5", 1),
    uint("83", 1),
    stringElement("86", "V_VP8"),
    master("E0", [
      uint("B0", width),
      uint("BA", height),
    ]),
  ]);

  const audioTrack = master("AE", [
    uint("D7", 2),
    uint("73C5", 2),
    uint("83", 2),
    stringElement("86", "A_OPUS"),
    element("63A2", createOpusHead(channels)),
    uint("56AA", 6_500_000),
    uint("56BB", 80_000_000),
    master("E1", [
      float64("B5", AV_OPUS_SAMPLE_RATE),
      uint("9F", channels),
    ]),
  ]);

  return master("1654AE6B", [videoTrack, audioTrack]);
}

type InterleavedBlock =
  | {
      readonly kind: "video";
      readonly timestampUs: number;
      readonly durationUs: number;
      readonly key: boolean;
      readonly data: Uint8Array;
      readonly ordinal: number;
    }
  | {
      readonly kind: "audio";
      readonly timestampUs: number;
      readonly durationUs: number;
      readonly data: Uint8Array;
      readonly ordinal: number;
    };

function validateVideoChunks(chunks: readonly AvVp8MuxChunk[]): number {
  if (chunks.length === 0) {
    throw new AvExportError("AV_EXPORT_INVALID_CHUNK", "At least one encoded VP8 chunk is required.");
  }
  let previousTimestampUs = -1;
  let endUs = 0;
  chunks.forEach((chunk, index) => {
    if (!Number.isSafeInteger(chunk.timestampUs) || chunk.timestampUs < 0) {
      throw new AvExportError("AV_EXPORT_INVALID_CHUNK", "VP8 timestamps must be non-negative integer microseconds.");
    }
    if (!Number.isSafeInteger(chunk.durationUs) || chunk.durationUs <= 0) {
      throw new AvExportError("AV_EXPORT_INVALID_CHUNK", "VP8 durations must be positive integer microseconds.");
    }
    if (chunk.timestampUs < previousTimestampUs) {
      throw new AvExportError("AV_EXPORT_INVALID_CHUNK", "VP8 chunks must be timestamp ordered.");
    }
    if (chunk.data.byteLength === 0) {
      throw new AvExportError("AV_EXPORT_INVALID_CHUNK", "Encoded VP8 chunks must not be empty.");
    }
    if (index === 0 && !chunk.key) {
      throw new AvExportError("AV_EXPORT_INVALID_CHUNK", "The first VP8 chunk must be a key frame.");
    }
    previousTimestampUs = chunk.timestampUs;
    endUs = Math.max(endUs, chunk.timestampUs + chunk.durationUs);
  });
  return endUs;
}

function validateAudioChunks(chunks: readonly AvOpusMuxChunk[]): number {
  if (chunks.length === 0) {
    throw new AvExportError("AV_EXPORT_INVALID_CHUNK", "At least one encoded Opus chunk is required.");
  }
  let previousTimestampUs = -1;
  let endUs = 0;
  for (const chunk of chunks) {
    if (!Number.isSafeInteger(chunk.timestampUs) || chunk.timestampUs < 0) {
      throw new AvExportError("AV_EXPORT_INVALID_CHUNK", "Opus timestamps must be non-negative integer microseconds.");
    }
    if (!Number.isSafeInteger(chunk.durationUs) || chunk.durationUs <= 0) {
      throw new AvExportError("AV_EXPORT_INVALID_CHUNK", "Opus durations must be positive integer microseconds.");
    }
    if (chunk.timestampUs < previousTimestampUs) {
      throw new AvExportError("AV_EXPORT_INVALID_CHUNK", "Opus chunks must be timestamp ordered.");
    }
    if (chunk.data.byteLength === 0) {
      throw new AvExportError("AV_EXPORT_INVALID_CHUNK", "Encoded Opus chunks must not be empty.");
    }
    previousTimestampUs = chunk.timestampUs;
    endUs = Math.max(endUs, chunk.timestampUs + chunk.durationUs);
  }
  return endUs;
}

function simpleBlock(block: InterleavedBlock, relativeMs: number): Uint8Array {
  const trackNumber = block.kind === "video" ? 0x81 : 0x82;
  const flags = block.kind === "video" && block.key ? 0x80 : 0x00;
  return element("A3", concat([
    new Uint8Array([trackNumber]),
    signed16(relativeMs),
    new Uint8Array([flags]),
    block.data,
  ]));
}

function interleave(
  videoChunks: readonly AvVp8MuxChunk[],
  audioChunks: readonly AvOpusMuxChunk[],
): InterleavedBlock[] {
  const blocks: InterleavedBlock[] = [];
  videoChunks.forEach((chunk, ordinal) => {
    blocks.push({ kind: "video", ...chunk, ordinal });
  });
  audioChunks.forEach((chunk, ordinal) => {
    blocks.push({ kind: "audio", ...chunk, ordinal });
  });
  blocks.sort((left, right) => {
    if (left.timestampUs !== right.timestampUs) return left.timestampUs - right.timestampUs;
    if (left.kind !== right.kind) return left.kind === "video" ? -1 : 1;
    return left.ordinal - right.ordinal;
  });
  return blocks;
}

function clusters(blocks: readonly InterleavedBlock[]): Uint8Array[] {
  const output: Uint8Array[] = [];
  let clusterStartMs: number | null = null;
  let clusterBlocks: Uint8Array[] = [];

  const flush = (): void => {
    if (clusterStartMs === null || clusterBlocks.length === 0) return;
    output.push(master("1F43B675", [uint("E7", clusterStartMs), ...clusterBlocks]));
    clusterStartMs = null;
    clusterBlocks = [];
  };

  for (const block of blocks) {
    const timeMs = Math.round(block.timestampUs / 1000);
    if (clusterStartMs === null) clusterStartMs = timeMs;
    let relativeMs = timeMs - clusterStartMs;
    if (relativeMs > MAX_CLUSTER_SPAN_MS || relativeMs > 32_767) {
      flush();
      clusterStartMs = timeMs;
      relativeMs = 0;
    }
    clusterBlocks.push(simpleBlock(block, relativeMs));
  }
  flush();
  return output;
}

function validateMuxConfig(width: number, height: number, channels: number): asserts channels is 1 | 2 {
  if (!Number.isInteger(width) || width <= 0 || width > 16_384) {
    throw new AvExportError("AV_EXPORT_INVALID_CONFIG", `Invalid video width ${width}.`);
  }
  if (!Number.isInteger(height) || height <= 0 || height > 16_384) {
    throw new AvExportError("AV_EXPORT_INVALID_CONFIG", `Invalid video height ${height}.`);
  }
  if (channels !== 1 && channels !== 2) {
    throw new AvExportError("AV_EXPORT_INVALID_CONFIG", `Invalid Opus channel count ${channels}.`);
  }
}

export function muxVp8OpusWebM(
  width: number,
  height: number,
  numberOfChannels: 1 | 2,
  videoChunks: readonly AvVp8MuxChunk[],
  audioChunks: readonly AvOpusMuxChunk[],
): Uint8Array {
  validateMuxConfig(width, height, numberOfChannels);
  const videoEndUs = validateVideoChunks(videoChunks);
  const audioEndUs = validateAudioChunks(audioChunks);
  const durationUs = Math.max(videoEndUs, audioEndUs);

  return concat([
    ebmlHeader(),
    master("18538067", [
      info(durationUs / 1000),
      tracks(width, height, numberOfChannels),
      ...clusters(interleave(videoChunks, audioChunks)),
    ]),
  ]);
}

function validateExportOptions(options: Vp8OpusWebMExportOptions): void {
  validateMuxConfig(options.width, options.height, options.numberOfChannels);

  if (!Number.isFinite(options.frameRate) || options.frameRate <= 0 || options.frameRate > 240) {
    throw new AvExportError("AV_EXPORT_INVALID_CONFIG", `Invalid frame rate ${options.frameRate}.`);
  }
  if (!Number.isInteger(options.frameCount) || options.frameCount <= 0 || options.frameCount > 1_000_000) {
    throw new AvExportError("AV_EXPORT_INVALID_CONFIG", `Invalid frame count ${options.frameCount}.`);
  }
  if (options.videoBitrate !== undefined && (!Number.isInteger(options.videoBitrate) || options.videoBitrate <= 0)) {
    throw new AvExportError("AV_EXPORT_INVALID_CONFIG", `Invalid video bitrate ${options.videoBitrate}.`);
  }
  if (
    options.keyFrameIntervalFrames !== undefined
    && (!Number.isInteger(options.keyFrameIntervalFrames) || options.keyFrameIntervalFrames <= 0)
  ) {
    throw new AvExportError(
      "AV_EXPORT_INVALID_CONFIG",
      `Invalid key-frame interval ${options.keyFrameIntervalFrames}.`,
    );
  }
  if (
    !Number.isInteger(options.totalAudioFrames)
    || options.totalAudioFrames <= 0
    || options.totalAudioFrames > AV_OPUS_SAMPLE_RATE * 86_400
  ) {
    throw new AvExportError("AV_EXPORT_INVALID_CONFIG", `Invalid PCM frame count ${options.totalAudioFrames}.`);
  }
  const audioChunkFrames = options.audioChunkFrames ?? DEFAULT_AUDIO_CHUNK_FRAMES;
  if (
    !Number.isInteger(audioChunkFrames)
    || audioChunkFrames <= 0
    || audioChunkFrames > AV_OPUS_SAMPLE_RATE * 10
  ) {
    throw new AvExportError("AV_EXPORT_INVALID_CONFIG", `Invalid PCM chunk size ${audioChunkFrames}.`);
  }
  if (
    options.audioBitrate !== undefined
    && (!Number.isInteger(options.audioBitrate) || options.audioBitrate < 6_000 || options.audioBitrate > 510_000)
  ) {
    throw new AvExportError("AV_EXPORT_INVALID_CONFIG", `Invalid Opus bitrate ${options.audioBitrate}.`);
  }
}

async function encodeVideo(options: Vp8OpusWebMExportOptions): Promise<AvVp8MuxChunk[]> {
  const bitrate = options.videoBitrate
    ?? Math.max(250_000, Math.round(options.width * options.height * options.frameRate * 0.08));
  const config: VideoEncoderConfig = {
    codec: AV_VIDEO_CODEC,
    width: options.width,
    height: options.height,
    bitrate,
    framerate: options.frameRate,
    latencyMode: "quality",
  };
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) {
    throw new AvExportError(
      "AV_EXPORT_VIDEO_CODEC_UNSUPPORTED",
      `VP8 encoding is unsupported for ${options.width}x${options.height} @ ${options.frameRate} fps.`,
    );
  }

  const frameDurationUs = Math.max(1, Math.round(1_000_000 / options.frameRate));
  const keyFrameInterval = options.keyFrameIntervalFrames ?? Math.max(1, Math.round(options.frameRate * 2));
  const chunks: AvVp8MuxChunk[] = [];
  let failureMessage: string | null = null;

  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({
        timestampUs: chunk.timestamp,
        durationUs: chunk.duration ?? frameDurationUs,
        key: chunk.type === "key",
        data,
      });
    },
    error: (error) => {
      failureMessage = error.message;
    },
  });

  try {
    encoder.configure(support.config ?? config);
    for (let frameIndex = 0; frameIndex < options.frameCount; frameIndex += 1) {
      const timestampUs = frameIndex * frameDurationUs;
      const frame = await options.createFrame(frameIndex, timestampUs, frameDurationUs);
      try {
        if (frame.timestamp !== timestampUs) {
          throw new AvExportError(
            "AV_EXPORT_INVALID_VIDEO_FRAME",
            `VideoFrame timestamp ${frame.timestamp} does not match requested ${timestampUs} us.`,
          );
        }
        encoder.encode(frame, {
          keyFrame: frameIndex === 0 || frameIndex % keyFrameInterval === 0,
        });
      } finally {
        frame.close();
      }

      if (encoder.encodeQueueSize > 8) await encoder.flush();
      if (failureMessage !== null) {
        throw new AvExportError("AV_EXPORT_VIDEO_ENCODER_FAILED", failureMessage);
      }
    }
    await encoder.flush();
  } catch (error) {
    if (error instanceof AvExportError) throw error;
    throw new AvExportError(
      "AV_EXPORT_VIDEO_ENCODER_FAILED",
      error instanceof Error ? error.message : "VP8 encoder failed.",
      error instanceof Error ? { cause: error } : undefined,
    );
  } finally {
    encoder.close();
  }

  if (failureMessage !== null) {
    throw new AvExportError("AV_EXPORT_VIDEO_ENCODER_FAILED", failureMessage);
  }
  if (chunks.length === 0) {
    throw new AvExportError("AV_EXPORT_VIDEO_ENCODER_FAILED", "VP8 encoder produced no chunks.");
  }
  chunks.sort((left, right) => left.timestampUs - right.timestampUs);
  return chunks;
}

async function encodeAudio(options: Vp8OpusWebMExportOptions): Promise<AvOpusMuxChunk[]> {
  const bitrate = options.audioBitrate ?? (options.numberOfChannels === 1 ? 64_000 : 128_000);
  const config: AudioEncoderConfig = {
    codec: AV_AUDIO_CODEC,
    sampleRate: AV_OPUS_SAMPLE_RATE,
    numberOfChannels: options.numberOfChannels,
    bitrate,
  };
  const support = await AudioEncoder.isConfigSupported(config);
  if (!support.supported) {
    throw new AvExportError(
      "AV_EXPORT_AUDIO_CODEC_UNSUPPORTED",
      `Opus encoding is unsupported for ${AV_OPUS_SAMPLE_RATE} Hz / ${options.numberOfChannels} channel(s).`,
    );
  }

  const chunkFrames = options.audioChunkFrames ?? DEFAULT_AUDIO_CHUNK_FRAMES;
  const fallbackDurationUs = Math.max(1, Math.round((chunkFrames * 1_000_000) / AV_OPUS_SAMPLE_RATE));
  const chunks: AvOpusMuxChunk[] = [];
  let failureMessage: string | null = null;

  const encoder = new AudioEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({
        timestampUs: chunk.timestamp,
        durationUs: chunk.duration ?? fallbackDurationUs,
        data,
      });
    },
    error: (error) => {
      failureMessage = error.message;
    },
  });

  try {
    encoder.configure(support.config ?? config);
    for (
      let startFrame = 0;
      startFrame < options.totalAudioFrames;
      startFrame += chunkFrames
    ) {
      const frameCount = Math.min(chunkFrames, options.totalAudioFrames - startFrame);
      const timestampUs = Math.round((startFrame * 1_000_000) / AV_OPUS_SAMPLE_RATE);
      const audioData = await options.createAudioData(startFrame, frameCount, timestampUs);
      try {
        if (
          audioData.sampleRate !== AV_OPUS_SAMPLE_RATE
          || audioData.numberOfChannels !== options.numberOfChannels
          || audioData.numberOfFrames !== frameCount
          || audioData.timestamp !== timestampUs
        ) {
          throw new AvExportError(
            "AV_EXPORT_INVALID_AUDIO_DATA",
            `AudioData does not match requested ${AV_OPUS_SAMPLE_RATE} Hz / ${options.numberOfChannels} channel(s) / ${frameCount} frames / ${timestampUs} us.`,
          );
        }
        encoder.encode(audioData);
      } finally {
        audioData.close();
      }

      if (encoder.encodeQueueSize > 16) await encoder.flush();
      if (failureMessage !== null) {
        throw new AvExportError("AV_EXPORT_AUDIO_ENCODER_FAILED", failureMessage);
      }
    }
    await encoder.flush();
  } catch (error) {
    if (error instanceof AvExportError) throw error;
    throw new AvExportError(
      "AV_EXPORT_AUDIO_ENCODER_FAILED",
      error instanceof Error ? error.message : "Opus encoder failed.",
      error instanceof Error ? { cause: error } : undefined,
    );
  } finally {
    encoder.close();
  }

  if (failureMessage !== null) {
    throw new AvExportError("AV_EXPORT_AUDIO_ENCODER_FAILED", failureMessage);
  }
  if (chunks.length === 0) {
    throw new AvExportError("AV_EXPORT_AUDIO_ENCODER_FAILED", "Opus encoder produced no chunks.");
  }
  chunks.sort((left, right) => left.timestampUs - right.timestampUs);
  return chunks;
}

export async function exportVp8OpusWebM(
  options: Vp8OpusWebMExportOptions,
): Promise<Vp8OpusWebMExportResult> {
  validateExportOptions(options);

  if (
    typeof VideoEncoder === "undefined"
    || typeof VideoFrame === "undefined"
    || typeof AudioEncoder === "undefined"
    || typeof AudioData === "undefined"
  ) {
    throw new AvExportError(
      "AV_EXPORT_WEBCODECS_UNAVAILABLE",
      "WebCodecs VideoEncoder/VideoFrame/AudioEncoder/AudioData is unavailable.",
    );
  }

  const [videoChunks, audioChunks] = await Promise.all([
    encodeVideo(options),
    encodeAudio(options),
  ]);

  const videoDurationUs = options.frameCount * Math.max(1, Math.round(1_000_000 / options.frameRate));
  const audioDurationUs = Math.round((options.totalAudioFrames * 1_000_000) / AV_OPUS_SAMPLE_RATE);
  const durationUs = Math.max(videoDurationUs, audioDurationUs);

  return {
    bytes: muxVp8OpusWebM(
      options.width,
      options.height,
      options.numberOfChannels,
      videoChunks,
      audioChunks,
    ),
    mimeType: AV_WEBM_MIME_TYPE,
    videoCodec: AV_VIDEO_CODEC,
    audioCodec: AV_AUDIO_CODEC,
    width: options.width,
    height: options.height,
    frameRate: options.frameRate,
    frameCount: options.frameCount,
    sampleRate: AV_OPUS_SAMPLE_RATE,
    numberOfChannels: options.numberOfChannels,
    totalAudioFrames: options.totalAudioFrames,
    durationUs,
    encodedVideoChunks: videoChunks.length,
    encodedAudioChunks: audioChunks.length,
  };
}

export function hasVp8OpusWebMHeader(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4
    && bytes[0] === 0x1a
    && bytes[1] === 0x45
    && bytes[2] === 0xdf
    && bytes[3] === 0xa3;
}
