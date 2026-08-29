export const OPUS_WEBM_MIME_TYPE = "audio/webm;codecs=opus" as const;
export const OPUS_CODEC = "opus" as const;
export const OPUS_SAMPLE_RATE = 48_000 as const;
export const WEBM_TIMECODE_SCALE_NS = 1_000_000 as const;

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
  readonly sampleRate?: typeof OPUS_SAMPLE_RATE;
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

const textEncoder = new TextEncoder();

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

function copyBytes(data: Uint8Array): Uint8Array {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
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
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", `Invalid EBML size ${value}.`);
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
  throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", "EBML element exceeds supported size.");
}

function element(id: string, payload: Uint8Array): Uint8Array {
  return concatBytes([idBytes(id), encodeVintSize(payload.byteLength), payload]);
}

function master(id: string, children: readonly Uint8Array[]): Uint8Array {
  return element(id, concatBytes(children));
}

function unsignedBytes(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", `Invalid unsigned EBML value ${value}.`);
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
  return element(id, textEncoder.encode(value));
}

function float64Element(id: string, value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return element(id, bytes);
}

function int16Bytes(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < -32_768 || value > 32_767) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", `Invalid SimpleBlock timecode ${value}.`);
  }
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setInt16(0, value, false);
  return bytes;
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

export function createOpusHead(numberOfChannels: 1 | 2, sampleRate = OPUS_SAMPLE_RATE): Uint8Array {
  validateAudioConfig(sampleRate, numberOfChannels);
  const bytes = new Uint8Array(19);
  bytes.set(textEncoder.encode("OpusHead"), 0);
  bytes[8] = 1;
  bytes[9] = numberOfChannels;
  const view = new DataView(bytes.buffer);
  view.setUint16(10, 312, true);
  view.setUint32(12, sampleRate, true);
  view.setInt16(16, 0, true);
  bytes[18] = 0;
  return bytes;
}

function makeTracks(sampleRate: number, numberOfChannels: 1 | 2, codecPrivate: Uint8Array): Uint8Array {
  return master("1654AE6B", [
    master("AE", [
      uintElement("D7", 1),
      uintElement("73C5", 1),
      uintElement("83", 2),
      stringElement("86", "A_OPUS"),
      element("63A2", codecPrivate),
      uintElement("56AA", 6_500_000),
      uintElement("56BB", 80_000_000),
      master("E1", [
        float64Element("B5", sampleRate),
        uintElement("9F", numberOfChannels),
      ]),
    ]),
  ]);
}

function simpleAudioBlock(chunk: OpusMuxChunk, relativeMs: number): Uint8Array {
  if (chunk.data.byteLength === 0) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", "Encoded Opus chunk must not be empty.");
  }
  return element("A3", concatBytes([
    new Uint8Array([0x81]),
    int16Bytes(relativeMs),
    new Uint8Array([0x00]),
    chunk.data,
  ]));
}

function makeClusters(chunks: readonly OpusMuxChunk[]): Uint8Array[] {
  const clusters: Uint8Array[] = [];
  let clusterStartMs: number | null = null;
  let blocks: Uint8Array[] = [];
  let previousTimestampUs = -1;

  const flush = (): void => {
    if (clusterStartMs === null || blocks.length === 0) return;
    clusters.push(master("1F43B675", [uintElement("E7", clusterStartMs), ...blocks]));
    clusterStartMs = null;
    blocks = [];
  };

  for (const chunk of chunks) {
    if (!Number.isSafeInteger(chunk.timestampUs) || chunk.timestampUs < 0) {
      throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", "Opus chunk timestamp must be a non-negative integer in microseconds.");
    }
    if (!Number.isSafeInteger(chunk.durationUs) || chunk.durationUs <= 0) {
      throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", "Opus chunk duration must be a positive integer in microseconds.");
    }
    if (chunk.timestampUs < previousTimestampUs) {
      throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", "Opus chunks must be ordered by timestamp.");
    }
    previousTimestampUs = chunk.timestampUs;

    const timeMs = Math.round(chunk.timestampUs / 1000);
    if (clusterStartMs === null) clusterStartMs = timeMs;
    let relativeMs = timeMs - clusterStartMs;
    if (relativeMs > 30_000 || relativeMs > 32_767) {
      flush();
      clusterStartMs = timeMs;
      relativeMs = 0;
    }
    blocks.push(simpleAudioBlock(chunk, relativeMs));
  }
  flush();
  return clusters;
}

function validateAudioConfig(sampleRate: number, numberOfChannels: number): asserts numberOfChannels is 1 | 2 {
  if (sampleRate !== OPUS_SAMPLE_RATE) {
    throw new AudioExportError(
      "AUDIO_EXPORT_INVALID_CONFIG",
      `Opus WebM v1 requires ${OPUS_SAMPLE_RATE} Hz audio; received ${sampleRate}.`,
    );
  }
  if (numberOfChannels !== 1 && numberOfChannels !== 2) {
    throw new AudioExportError(
      "AUDIO_EXPORT_INVALID_CONFIG",
      `Opus WebM v1 supports mono or stereo audio; received ${numberOfChannels} channels.`,
    );
  }
}

export function muxOpusWebM(
  sampleRate: number,
  numberOfChannels: 1 | 2,
  chunks: readonly OpusMuxChunk[],
  codecPrivate = createOpusHead(numberOfChannels, sampleRate),
): Uint8Array {
  validateAudioConfig(sampleRate, numberOfChannels);
  if (chunks.length === 0) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", "At least one encoded Opus chunk is required.");
  }
  if (codecPrivate.byteLength === 0) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", "Opus CodecPrivate must not be empty.");
  }

  const last = chunks[chunks.length - 1];
  if (last === undefined) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CHUNK", "At least one encoded Opus chunk is required.");
  }
  const durationUs = last.timestampUs + last.durationUs;
  const segment = master("18538067", [
    makeInfo(durationUs / 1000),
    makeTracks(sampleRate, numberOfChannels, codecPrivate),
    ...makeClusters(chunks),
  ]);
  return concatBytes([makeEbmlHeader(), segment]);
}

function validateExportOptions(options: OpusWebMExportOptions): void {
  const sampleRate = options.sampleRate ?? OPUS_SAMPLE_RATE;
  validateAudioConfig(sampleRate, options.numberOfChannels);
  if (!Number.isInteger(options.totalFrames) || options.totalFrames <= 0 || options.totalFrames > sampleRate * 60 * 60 * 24) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CONFIG", `Invalid total PCM frame count ${options.totalFrames}.`);
  }
  const chunkFrames = options.chunkFrames ?? 960;
  if (!Number.isInteger(chunkFrames) || chunkFrames <= 0 || chunkFrames > sampleRate * 10) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CONFIG", `Invalid PCM chunk size ${chunkFrames}.`);
  }
  if (options.bitrate !== undefined && (!Number.isInteger(options.bitrate) || options.bitrate < 6_000 || options.bitrate > 510_000)) {
    throw new AudioExportError("AUDIO_EXPORT_INVALID_CONFIG", `Invalid Opus bitrate ${options.bitrate}.`);
  }
}

function copyDescription(description: AllowSharedBufferSource): Uint8Array {
  if (description instanceof ArrayBuffer) return copyBytes(new Uint8Array(description));
  if (typeof SharedArrayBuffer !== "undefined" && description instanceof SharedArrayBuffer) {
    return copyBytes(new Uint8Array(description));
  }
  return copyBytes(new Uint8Array(description.buffer, description.byteOffset, description.byteLength));
}

export async function exportOpusWebM(options: OpusWebMExportOptions): Promise<OpusWebMExportResult> {
  validateExportOptions(options);
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") {
    throw new AudioExportError(
      "AUDIO_EXPORT_WEBCODECS_UNAVAILABLE",
      "WebCodecs AudioEncoder/AudioData is unavailable in this browser.",
    );
  }

  const sampleRate = options.sampleRate ?? OPUS_SAMPLE_RATE;
  const chunkFrames = options.chunkFrames ?? 960;
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
      `Browser does not support Opus encoding at ${sampleRate} Hz / ${options.numberOfChannels} channel(s).`,
    );
  }

  const chunks: OpusMuxChunk[] = [];
  let codecPrivate: Uint8Array | null = null;
  let encoderFailure: Error | null = null;
  const fallbackDurationUs = Math.max(1, Math.round((chunkFrames * 1_000_000) / sampleRate));
  const audioEncoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({
        timestampUs: chunk.timestamp,
        durationUs: chunk.duration ?? fallbackDurationUs,
        data,
      });
      const description = metadata.decoderConfig?.description;
      if (codecPrivate === null && description !== undefined) {
        codecPrivate = copyDescription(description);
      }
    },
    error: (error) => {
      encoderFailure = error;
    },
  });

  try {
    audioEncoder.configure(support.config ?? config);
    for (let startFrame = 0; startFrame < options.totalFrames; startFrame += chunkFrames) {
      const frameCount = Math.min(chunkFrames, options.totalFrames - startFrame);
      const timestampUs = Math.round((startFrame * 1_000_000) / sampleRate);
      const data = await options.createAudioData(startFrame, frameCount, timestampUs);
      try {
        if (
          data.sampleRate !== sampleRate
          || data.numberOfChannels !== options.numberOfChannels
          || data.numberOfFrames !== frameCount
          || data.timestamp !== timestampUs
        ) {
          throw new AudioExportError(
            "AUDIO_EXPORT_INVALID_AUDIO_DATA",
            `AudioData must match requested ${sampleRate} Hz / ${options.numberOfChannels} channel(s) / ${frameCount} frames / ${timestampUs} us timestamp.`,
          );
        }
        audioEncoder.encode(data);
      } finally {
        data.close();
      }
      if (audioEncoder.encodeQueueSize > 16) await audioEncoder.flush();
      if (encoderFailure !== null) throw encoderFailure;
    }
    await audioEncoder.flush();
  } catch (error) {
    if (error instanceof AudioExportError) throw error;
    throw new AudioExportError(
      "AUDIO_EXPORT_ENCODER_FAILED",
      error instanceof Error ? error.message : "Opus encoder failed.",
      error instanceof Error ? { cause: error } : undefined,
    );
  } finally {
    audioEncoder.close();
  }

  const finalEncoderFailure = encoderFailure as Error | null;
  if (finalEncoderFailure !== null) {
    throw new AudioExportError("AUDIO_EXPORT_ENCODER_FAILED", finalEncoderFailure.message, { cause: finalEncoderFailure });
  }
  if (chunks.length === 0) {
    throw new AudioExportError("AUDIO_EXPORT_ENCODER_FAILED", "Opus encoder produced no chunks.");
  }
  chunks.sort((left, right) => left.timestampUs - right.timestampUs);

  const durationUs = Math.round((options.totalFrames * 1_000_000) / sampleRate);
  const privateBytes = codecPrivate !== null && codecPrivate.byteLength > 0
    ? codecPrivate
    : createOpusHead(options.numberOfChannels, sampleRate);
  return {
    bytes: muxOpusWebM(sampleRate, options.numberOfChannels, chunks, privateBytes),
    mimeType: OPUS_WEBM_MIME_TYPE,
    codec: OPUS_CODEC,
    sampleRate: OPUS_SAMPLE_RATE,
    numberOfChannels: options.numberOfChannels,
    totalFrames: options.totalFrames,
    durationUs,
    encodedChunks: chunks.length,
  };
}

export function hasOpusWebMHeader(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4
    && bytes[0] === 0x1a
    && bytes[1] === 0x45
    && bytes[2] === 0xdf
    && bytes[3] === 0xa3;
}
