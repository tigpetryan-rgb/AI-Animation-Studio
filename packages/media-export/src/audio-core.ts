export const OPUS_WEBM_MIME_TYPE = "audio/webm;codecs=opus" as const;
export const OPUS_CODEC = "opus" as const;
export const OPUS_SAMPLE_RATE = 48_000 as const;

const WEBM_TIMECODE_SCALE_NS = 1_000_000;
const DEFAULT_CHUNK_FRAMES = 960;

export type AudioExportErrorCode =
  | "AUDIO_EXPORT_INVALID_CONFIG"
  | "AUDIO_EXPORT_WEBCODECS_UNAVAILABLE"
  | "AUDIO_EXPORT_CODEC_UNSUPPORTED"
  | "AUDIO_EXPORT_ENCODER_FAILED"
  | "AUDIO_EXPORT_INVALID_CHUNK"
  | "AUDIO_EXPORT_INVALID_AUDIO_DATA";

export class AudioExportError extends Error {
  readonly code: AudioExportErrorCode;

  constructor(code: AudioExportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AudioExportError";
    this.code = code;
  }
}

export interface OpusMuxChunk {
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly data: Uint8Array;
}

export interface OpusWebMExportOptions {
  readonly sampleRate?: number;
  readonly numberOfChannels: 1 | 2;
  readonly totalFrames: number;
  readonly chunkFrames?: number;
  readonly bitrate?: number;
  readonly createAudioData: (
    startFrame: number,
    frameCount: number,
    timestampUs: number,
  ) => AudioData | Promise<AudioData>;
}

export interface OpusWebMExportResult {
  readonly bytes: Uint8Array;
  readonly mimeType: typeof OPUS_WEBM_MIME_TYPE;
  readonly codec: typeof OPUS_CODEC;
  readonly sampleRate: typeof OPUS_SAMPLE_RATE;
  readonly numberOfChannels: 1 | 2;
  readonly totalFrames: number;
  readonly durationUs: number;
  readonly encodedChunks: number;
}

const utf8 = new TextEncoder();

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function id(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function vint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", `Invalid EBML size ${value}.`);
  }
  for (let width = 1; width <= 8; width += 1) {
    if (value <= 2 ** (7 * width) - 2) {
      const bytes = new Uint8Array(width);
      let remaining = value;
      for (let i = width - 1; i >= 0; i -= 1) {
        bytes[i] = remaining & 0xff;
        remaining = Math.floor(remaining / 256);
      }
      bytes[0] = (bytes[0] ?? 0) | (1 << (8 - width));
      return bytes;
    }
  }
  throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", "EBML element is too large.");
}

function element(elementId: string, payload: Uint8Array): Uint8Array {
  return concat([id(elementId), vint(payload.byteLength), payload]);
}

function master(elementId: string, children: readonly Uint8Array[]): Uint8Array {
  return element(elementId, concat(children));
}

function unsigned(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", `Invalid EBML integer ${value}.`);
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
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", `Invalid SimpleBlock timecode ${value}.`);
  }
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setInt16(0, value, false);
  return bytes;
}

function validateConfig(sampleRate: number, channels: number): asserts channels is 1 | 2 {
  if (sampleRate !== OPUS_SAMPLE_RATE) {
    throw new AudioExportError(
      "AUDIO_EXPORT_INVALID_CONFIG",
      `Opus WebM v1 requires ${OPUS_SAMPLE_RATE} Hz; received ${sampleRate}.`,
    );
  }
  if (channels !== 1 && channels !== 2) {
    throw new AudioExportError(
      "AUDIO_EXPORT_INVALID_CONFIG",
      `Opus WebM v1 supports one or two channels; received ${channels}.`,
    );
  }
}

export function createOpusHead(channels: 1 | 2, sampleRate: number = OPUS_SAMPLE_RATE): Uint8Array {
  validateConfig(sampleRate, channels);
  const bytes = new Uint8Array(19);
  bytes.set(utf8.encode("OpusHead"), 0);
  bytes[8] = 1;
  bytes[9] = channels;
  const view = new DataView(bytes.buffer);
  view.setUint16(10, 312, true);
  view.setUint32(12, sampleRate, true);
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
    uint("2AD7B1", WEBM_TIMECODE_SCALE_NS),
    float64("4489", durationMs),
    stringElement("4D80", "AI Animation Studio"),
    stringElement("5741", "AI Animation Studio"),
  ]);
}

function tracks(sampleRate: number, channels: 1 | 2): Uint8Array {
  return master("1654AE6B", [
    master("AE", [
      uint("D7", 1),
      uint("73C5", 1),
      uint("83", 2),
      stringElement("86", "A_OPUS"),
      element("63A2", createOpusHead(channels, sampleRate)),
      uint("56AA", 6_500_000),
      uint("56BB", 80_000_000),
      master("E1", [
        float64("B5", sampleRate),
        uint("9F", channels),
      ]),
    ]),
  ]);
}

function simpleBlock(chunk: OpusMuxChunk, relativeMs: number): Uint8Array {
  if (chunk.data.byteLength === 0) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", "Encoded Opus chunk is empty.");
  }
  return element("A3", concat([
    new Uint8Array([0x81]),
    signed16(relativeMs),
    new Uint8Array([0x00]),
    chunk.data,
  ]));
}

function clusters(chunks: readonly OpusMuxChunk[]): Uint8Array[] {
  const output: Uint8Array[] = [];
  let clusterStartMs: number | null = null;
  let blocks: Uint8Array[] = [];
  let previousTimestampUs = -1;

  const flush = (): void => {
    if (clusterStartMs === null || blocks.length === 0) return;
    output.push(master("1F43B675", [uint("E7", clusterStartMs), ...blocks]));
    clusterStartMs = null;
    blocks = [];
  };

  for (const chunk of chunks) {
    if (!Number.isSafeInteger(chunk.timestampUs) || chunk.timestampUs < 0) {
      throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", "Opus timestamp must be a non-negative integer in microseconds.");
    }
    if (!Number.isSafeInteger(chunk.durationUs) || chunk.durationUs <= 0) {
      throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", "Opus duration must be a positive integer in microseconds.");
    }
    if (chunk.timestampUs < previousTimestampUs) {
      throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", "Opus chunks must be timestamp ordered.");
    }
    previousTimestampUs = chunk.timestampUs;

    const timeMs = Math.round(chunk.timestampUs / 1000);
    if (clusterStartMs === null) clusterStartMs = timeMs;
    let relativeMs = timeMs - clusterStartMs;
    if (relativeMs > 30_000) {
      flush();
      clusterStartMs = timeMs;
      relativeMs = 0;
    }
    blocks.push(simpleBlock(chunk, relativeMs));
  }
  flush();
  return output;
}

export function muxOpusWebM(
  sampleRate: number,
  channels: 1 | 2,
  encodedChunks: readonly OpusMuxChunk[],
): Uint8Array {
  validateConfig(sampleRate, channels);
  if (encodedChunks.length === 0) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", "At least one Opus chunk is required.");
  }
  const last = encodedChunks[encodedChunks.length - 1];
  if (last === undefined) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", "At least one Opus chunk is required.");
  }
  const durationUs = last.timestampUs + last.durationUs;
  return concat([
    ebmlHeader(),
    master("18538067", [
      info(durationUs / 1000),
      tracks(sampleRate, channels),
      ...clusters(encodedChunks),
    ]),
  ]);
}

function validateOptions(options: OpusWebMExportOptions): void {
  const sampleRate = options.sampleRate ?? OPUS_SAMPLE_RATE;
  validateConfig(sampleRate, options.numberOfChannels);
  if (!Number.isInteger(options.totalFrames) || options.totalFrames <= 0 || options.totalFrames > sampleRate * 86_400) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CONFIG", `Invalid PCM frame count ${options.totalFrames}.`);
  }
  const chunkFrames = options.chunkFrames ?? DEFAULT_CHUNK_FRAMES;
  if (!Number.isInteger(chunkFrames) || chunkFrames <= 0 || chunkFrames > sampleRate * 10) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CONFIG", `Invalid PCM chunk size ${chunkFrames}.`);
  }
  if (options.bitrate !== undefined && (!Number.isInteger(options.bitrate) || options.bitrate < 6_000 || options.bitrate > 510_000)) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CONFIG", `Invalid Opus bitrate ${options.bitrate}.`);
  }
}

export async function exportOpusWebM(options: OpusWebMExportOptions): Promise<OpusWebMExportResult> {
  validateOptions(options);
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") {
    throw new AudioExportError(
      "AUDIO_EXPORT_WEBCODECS_UNAVAILABLE",
      "WebCodecs AudioEncoder/AudioData is unavailable.",
    );
  }

  const sampleRate = options.sampleRate ?? OPUS_SAMPLE_RATE;
  const chunkFrames = options.chunkFrames ?? DEFAULT_CHUNK_FRAMES;
  const bitrate = options.bitrate ?? (options.numberOfChannels === 1 ? 64_000 : 128_000);
  const config: AudioEncoderConfig = {
    codec: OPUS_CODEC,
    sampleRate,
    numberOfChannels: options.numberOfChannels,
    bitrate,
  };
  const support = await AudioEncoder.isConfigSupported(config);
  if (!support.supported) {
    throw new AudioExportError(
      "AUDIO_EXPORT_CODEC_UNSUPPORTED",
      `Opus encoding is unsupported for ${sampleRate} Hz / ${options.numberOfChannels} channel(s).`,
    );
  }

  const encodedChunks: OpusMuxChunk[] = [];
  let failureMessage: string | null = null;
  const fallbackDurationUs = Math.max(1, Math.round((chunkFrames * 1_000_000) / sampleRate));
  const encoder = new AudioEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      encodedChunks.push({
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
    for (let startFrame = 0; startFrame < options.totalFrames; startFrame += chunkFrames) {
      const frameCount = Math.min(chunkFrames, options.totalFrames - startFrame);
      const timestampUs = Math.round((startFrame * 1_000_000) / sampleRate);
      const audioData = await options.createAudioData(startFrame, frameCount, timestampUs);
      try {
        if (
          audioData.sampleRate !== sampleRate
          || audioData.numberOfChannels !== options.numberOfChannels
          || audioData.numberOfFrames !== frameCount
          || audioData.timestamp !== timestampUs
        ) {
          throw new AudioExportError(
            "AUDIO_EXPORT_INVALID_AUDIO_DATA",
            `AudioData does not match requested ${sampleRate} Hz / ${options.numberOfChannels} channel(s) / ${frameCount} frames / ${timestampUs} us.`,
          );
        }
        encoder.encode(audioData);
      } finally {
        audioData.close();
      }
      if (encoder.encodeQueueSize > 16) await encoder.flush();
      if (failureMessage !== null) {
        throw new AudioExportError("AUDIO_EXPORT_ENCODER_FAILED", failureMessage);
      }
    }
    await encoder.flush();
  } catch (error) {
    if (error instanceof AudioExportError) throw error;
    throw new AudioExportError(
      "AUDIO_EXPORT_ENCODER_FAILED",
      error instanceof Error ? error.message : "Opus encoder failed.",
      error instanceof Error ? { cause: error } : undefined,
    );
  } finally {
    encoder.close();
  }

  if (failureMessage !== null) {
    throw new AudioExportError("AUDIO_EXPORT_ENCODER_FAILED", failureMessage);
  }
  if (encodedChunks.length === 0) {
    throw new AudioExportError("AUDIO_EXPORT_ENCODER_FAILED", "Opus encoder produced no chunks.");
  }
  encodedChunks.sort((a, b) => a.timestampUs - b.timestampUs);

  return {
    bytes: muxOpusWebM(sampleRate, options.numberOfChannels, encodedChunks),
    mimeType: OPUS_WEBM_MIME_TYPE,
    codec: OPUS_CODEC,
    sampleRate: OPUS_SAMPLE_RATE,
    numberOfChannels: options.numberOfChannels,
    totalFrames: options.totalFrames,
    durationUs: Math.round((options.totalFrames * 1_000_000) / sampleRate),
    encodedChunks: encodedChunks.length,
  };
}

export function hasOpusWebMHeader(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4
    && bytes[0] === 0x1a
    && bytes[1] === 0x45
    && bytes[2] === 0xdf
    && bytes[3] === 0xa3;
}
