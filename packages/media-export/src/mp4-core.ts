export const AV_MP4_MIME_TYPE = 'video/mp4;codecs="avc1.42001E,opus"' as const;
export const AV_MP4_VIDEO_CODEC = "avc1.42001E" as const;
export const AV_MP4_AUDIO_CODEC = "opus" as const;
export const AV_MP4_OPUS_SAMPLE_RATE = 48_000 as const;
export const AV_MP4_VIDEO_TIMESCALE = 90_000 as const;
export const AV_MP4_MOVIE_TIMESCALE = 1_000 as const;
export const AV_MP4_OPUS_PRE_SKIP = 312 as const;

const DEFAULT_AUDIO_CHUNK_FRAMES = 960;
const UINT32_MAX = 0xffff_ffff;

export type Mp4ExportErrorCode =
  | "MP4_EXPORT_INVALID_CONFIG"
  | "MP4_EXPORT_WEBCODECS_UNAVAILABLE"
  | "MP4_EXPORT_VIDEO_CODEC_UNSUPPORTED"
  | "MP4_EXPORT_AUDIO_CODEC_UNSUPPORTED"
  | "MP4_EXPORT_VIDEO_ENCODER_FAILED"
  | "MP4_EXPORT_AUDIO_ENCODER_FAILED"
  | "MP4_EXPORT_INVALID_VIDEO_FRAME"
  | "MP4_EXPORT_INVALID_AUDIO_DATA"
  | "MP4_EXPORT_INVALID_CHUNK"
  | "MP4_EXPORT_INVALID_AVCC"
  | "MP4_EXPORT_FILE_TOO_LARGE";

export class Mp4ExportError extends Error {
  readonly code: Mp4ExportErrorCode;

  constructor(code: Mp4ExportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "Mp4ExportError";
    this.code = code;
  }
}

export interface AvcMp4MuxChunk {
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly key: boolean;
  readonly data: Uint8Array;
}

export interface OpusMp4MuxChunk {
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly data: Uint8Array;
}

export interface AvcOpusMp4ExportOptions {
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

export interface AvcOpusMp4ExportResult {
  readonly bytes: Uint8Array;
  readonly mimeType: typeof AV_MP4_MIME_TYPE;
  readonly videoCodec: typeof AV_MP4_VIDEO_CODEC;
  readonly audioCodec: typeof AV_MP4_AUDIO_CODEC;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly frameCount: number;
  readonly sampleRate: typeof AV_MP4_OPUS_SAMPLE_RATE;
  readonly numberOfChannels: 1 | 2;
  readonly totalAudioFrames: number;
  readonly durationUs: number;
  readonly encodedVideoChunks: number;
  readonly encodedAudioChunks: number;
}

const utf8 = new TextEncoder();

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function zeros(length: number): Uint8Array {
  return new Uint8Array(length);
}

function fourcc(value: string): Uint8Array {
  if (value.length !== 4) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", `Invalid MP4 fourcc ${value}.`);
  }
  return utf8.encode(value);
}

function u16(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", `Invalid uint16 ${value}.`);
  }
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, false);
  return bytes;
}

function u32(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", `Invalid uint32 ${value}.`);
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function box(type: string, ...parts: readonly Uint8Array[]): Uint8Array {
  const payload = concat(parts);
  if (payload.byteLength + 8 > UINT32_MAX) {
    throw new Mp4ExportError("MP4_EXPORT_FILE_TOO_LARGE", `${type} exceeds 32-bit MP4 box size.`);
  }
  return concat([u32(payload.byteLength + 8), fourcc(type), payload]);
}

function fullBox(type: string, version: number, flags: number, ...parts: readonly Uint8Array[]): Uint8Array {
  if (!Number.isInteger(version) || version < 0 || version > 0xff) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", `Invalid MP4 version ${version}.`);
  }
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xff_ffff) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", `Invalid MP4 flags ${flags}.`);
  }
  return box(type, new Uint8Array([
    version,
    (flags >>> 16) & 0xff,
    (flags >>> 8) & 0xff,
    flags & 0xff,
  ]), ...parts);
}

function matrix(): Uint8Array {
  return concat([
    u32(0x0001_0000), u32(0), u32(0),
    u32(0), u32(0x0001_0000), u32(0),
    u32(0), u32(0), u32(0x4000_0000),
  ]);
}

function languageUnd(): Uint8Array {
  return u16(
    (("u".charCodeAt(0) - 0x60) << 10)
    | (("n".charCodeAt(0) - 0x60) << 5)
    | ("d".charCodeAt(0) - 0x60),
  );
}

function ftyp(): Uint8Array {
  return box(
    "ftyp",
    fourcc("isom"),
    u32(0x0000_0200),
    fourcc("isom"),
    fourcc("iso2"),
    fourcc("iso8"),
    fourcc("avc1"),
    fourcc("mp41"),
    fourcc("mp42"),
  );
}

function mvhd(duration: number): Uint8Array {
  return fullBox(
    "mvhd", 0, 0,
    u32(0), u32(0),
    u32(AV_MP4_MOVIE_TIMESCALE), u32(duration),
    u32(0x0001_0000), u16(0x0100), u16(0), zeros(8),
    matrix(), zeros(24), u32(3),
  );
}

function tkhd(trackId: number, duration: number, width: number, height: number, volume: number): Uint8Array {
  return fullBox(
    "tkhd", 0, 0x000007,
    u32(0), u32(0), u32(trackId), u32(0), u32(duration), zeros(8),
    u16(0), u16(0), u16(volume), u16(0), matrix(),
    u32(width * 65_536), u32(height * 65_536),
  );
}

function mdhd(timescale: number, duration: number): Uint8Array {
  return fullBox(
    "mdhd", 0, 0,
    u32(0), u32(0), u32(timescale), u32(duration), languageUnd(), u16(0),
  );
}

function hdlr(type: "vide" | "soun", name: string): Uint8Array {
  return fullBox(
    "hdlr", 0, 0,
    u32(0), fourcc(type), zeros(12), concat([utf8.encode(name), new Uint8Array([0])]),
  );
}

function dinf(): Uint8Array {
  return box("dinf", fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1)));
}

function vmhd(): Uint8Array {
  return fullBox("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0));
}

function smhd(): Uint8Array {
  return fullBox("smhd", 0, 0, u16(0), u16(0));
}

function avc1(width: number, height: number, avcC: Uint8Array): Uint8Array {
  return box(
    "avc1",
    zeros(6), u16(1),
    u16(0), u16(0), u32(0), u32(0), u32(0),
    u16(width), u16(height),
    u32(0x0048_0000), u32(0x0048_0000), u32(0), u16(1),
    zeros(32), u16(0x0018), u16(0xffff),
    box("avcC", avcC),
  );
}

function dOps(channels: 1 | 2): Uint8Array {
  return box(
    "dOps",
    new Uint8Array([0, channels]),
    u16(AV_MP4_OPUS_PRE_SKIP),
    u32(AV_MP4_OPUS_SAMPLE_RATE),
    u16(0),
    new Uint8Array([0]),
  );
}

function opus(channels: 1 | 2): Uint8Array {
  return box(
    "Opus",
    zeros(6), u16(1), zeros(8),
    u16(channels), u16(16), u16(0), u16(0),
    u32(AV_MP4_OPUS_SAMPLE_RATE * 65_536),
    dOps(channels),
  );
}

interface SttsEntry {
  readonly count: number;
  readonly duration: number;
}

function stts(durations: readonly number[]): Uint8Array {
  const entries: SttsEntry[] = [];
  for (const duration of durations) {
    if (!Number.isInteger(duration) || duration <= 0 || duration > UINT32_MAX) {
      throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", `Invalid sample duration ${duration}.`);
    }
    const previous = entries[entries.length - 1];
    if (previous !== undefined && previous.duration === duration) {
      entries[entries.length - 1] = { count: previous.count + 1, duration };
    } else {
      entries.push({ count: 1, duration });
    }
  }
  return fullBox(
    "stts", 0, 0, u32(entries.length),
    ...entries.flatMap((entry) => [u32(entry.count), u32(entry.duration)]),
  );
}

function stsc(sampleCount: number): Uint8Array {
  return fullBox("stsc", 0, 0, u32(1), u32(1), u32(sampleCount), u32(1));
}

function stsz(sizes: readonly number[]): Uint8Array {
  return fullBox("stsz", 0, 0, u32(0), u32(sizes.length), ...sizes.map(u32));
}

function stco(offset: number): Uint8Array {
  return fullBox("stco", 0, 0, u32(1), u32(offset));
}

function stss(samples: readonly number[]): Uint8Array {
  return fullBox("stss", 0, 0, u32(samples.length), ...samples.map(u32));
}

function videoStbl(
  width: number,
  height: number,
  avcC: Uint8Array,
  durations: readonly number[],
  sizes: readonly number[],
  syncSamples: readonly number[],
  offset: number,
): Uint8Array {
  return box(
    "stbl",
    fullBox("stsd", 0, 0, u32(1), avc1(width, height, avcC)),
    stts(durations), stsc(sizes.length), stsz(sizes), stco(offset), stss(syncSamples),
  );
}

function audioStbl(
  channels: 1 | 2,
  durations: readonly number[],
  sizes: readonly number[],
  offset: number,
): Uint8Array {
  return box(
    "stbl",
    fullBox("stsd", 0, 0, u32(1), opus(channels)),
    stts(durations), stsc(sizes.length), stsz(sizes), stco(offset),
  );
}

function videoTrak(
  width: number,
  height: number,
  avcC: Uint8Array,
  durations: readonly number[],
  sizes: readonly number[],
  syncSamples: readonly number[],
  mediaDuration: number,
  movieDuration: number,
  offset: number,
): Uint8Array {
  return box(
    "trak",
    tkhd(1, movieDuration, width, height, 0),
    box(
      "mdia",
      mdhd(AV_MP4_VIDEO_TIMESCALE, mediaDuration),
      hdlr("vide", "VideoHandler"),
      box("minf", vmhd(), dinf(), videoStbl(width, height, avcC, durations, sizes, syncSamples, offset)),
    ),
  );
}

function audioTrak(
  channels: 1 | 2,
  durations: readonly number[],
  sizes: readonly number[],
  mediaDuration: number,
  movieDuration: number,
  offset: number,
): Uint8Array {
  return box(
    "trak",
    tkhd(2, movieDuration, 0, 0, 0x0100),
    box(
      "mdia",
      mdhd(AV_MP4_OPUS_SAMPLE_RATE, mediaDuration),
      hdlr("soun", "SoundHandler"),
      box("minf", smhd(), dinf(), audioStbl(channels, durations, sizes, offset)),
    ),
  );
}

function moov(
  width: number,
  height: number,
  channels: 1 | 2,
  avcC: Uint8Array,
  videoDurations: readonly number[],
  videoSizes: readonly number[],
  syncSamples: readonly number[],
  audioDurations: readonly number[],
  audioSizes: readonly number[],
  videoOffset: number,
  audioOffset: number,
): Uint8Array {
  const videoDuration = videoDurations.reduce((sum, value) => sum + value, 0);
  const audioDuration = audioDurations.reduce((sum, value) => sum + value, 0);
  if (videoDuration > UINT32_MAX || audioDuration > UINT32_MAX) {
    throw new Mp4ExportError("MP4_EXPORT_FILE_TOO_LARGE", "Track duration exceeds version-0 MP4 limits.");
  }
  const videoMovieDuration = Math.max(
    1,
    Math.round(videoDuration * AV_MP4_MOVIE_TIMESCALE / AV_MP4_VIDEO_TIMESCALE),
  );
  const audioMovieDuration = Math.max(
    1,
    Math.round(audioDuration * AV_MP4_MOVIE_TIMESCALE / AV_MP4_OPUS_SAMPLE_RATE),
  );
  return box(
    "moov",
    mvhd(Math.max(videoMovieDuration, audioMovieDuration)),
    videoTrak(
      width, height, avcC, videoDurations, videoSizes, syncSamples,
      videoDuration, videoMovieDuration, videoOffset,
    ),
    audioTrak(
      channels, audioDurations, audioSizes,
      audioDuration, audioMovieDuration, audioOffset,
    ),
  );
}

function toTimescale(durationUs: number, timescale: number): number {
  return Math.max(1, Math.round(durationUs * timescale / 1_000_000));
}

function timelineDurations<T extends { readonly timestampUs: number; readonly durationUs: number }>(
  chunks: readonly T[],
): number[] {
  return chunks.map((chunk, index) => {
    const next = chunks[index + 1];
    const durationUs = next === undefined ? chunk.durationUs : next.timestampUs - chunk.timestampUs;
    if (!Number.isSafeInteger(durationUs) || durationUs <= 0) {
      throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", "Chunks must have a strictly increasing timeline.");
    }
    return durationUs;
  });
}

function validateVideoChunks(chunks: readonly AvcMp4MuxChunk[]): void {
  if (chunks.length === 0) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", "At least one H.264 chunk is required.");
  }
  let previous = -1;
  chunks.forEach((chunk, index) => {
    if (!Number.isSafeInteger(chunk.timestampUs) || chunk.timestampUs < 0) {
      throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", "H.264 timestamps must be non-negative integer microseconds.");
    }
    if (!Number.isSafeInteger(chunk.durationUs) || chunk.durationUs <= 0 || chunk.data.byteLength === 0) {
      throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", "H.264 chunks require positive duration and bytes.");
    }
    if (chunk.timestampUs <= previous) {
      throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", "H.264 chunks must have strictly increasing timestamps.");
    }
    if (index === 0 && !chunk.key) {
      throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", "The first H.264 chunk must be a key frame.");
    }
    previous = chunk.timestampUs;
  });
}

function validateAudioChunks(chunks: readonly OpusMp4MuxChunk[]): void {
  if (chunks.length === 0) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", "At least one Opus chunk is required.");
  }
  let previous = -1;
  for (const chunk of chunks) {
    if (!Number.isSafeInteger(chunk.timestampUs) || chunk.timestampUs < 0) {
      throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", "Opus timestamps must be non-negative integer microseconds.");
    }
    if (!Number.isSafeInteger(chunk.durationUs) || chunk.durationUs <= 0 || chunk.data.byteLength === 0) {
      throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", "Opus chunks require positive duration and bytes.");
    }
    if (chunk.timestampUs <= previous) {
      throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", "Opus chunks must have strictly increasing timestamps.");
    }
    previous = chunk.timestampUs;
  }
}

function validateMuxConfig(width: number, height: number, channels: number, avcC: Uint8Array): asserts channels is 1 | 2 {
  if (!Number.isInteger(width) || width <= 0 || width > 16_384) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_CONFIG", `Invalid video width ${width}.`);
  }
  if (!Number.isInteger(height) || height <= 0 || height > 16_384) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_CONFIG", `Invalid video height ${height}.`);
  }
  if (channels !== 1 && channels !== 2) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_CONFIG", `Invalid Opus channel count ${channels}.`);
  }
  if (avcC.byteLength < 7 || avcC[0] !== 1) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_AVCC", "Invalid AVCDecoderConfigurationRecord (avcC)." );
  }
}

export function muxAvcOpusMp4(
  width: number,
  height: number,
  numberOfChannels: 1 | 2,
  avcC: Uint8Array,
  videoChunks: readonly AvcMp4MuxChunk[],
  audioChunks: readonly OpusMp4MuxChunk[],
): Uint8Array {
  validateMuxConfig(width, height, numberOfChannels, avcC);
  validateVideoChunks(videoChunks);
  validateAudioChunks(audioChunks);

  const videoDurations = timelineDurations(videoChunks)
    .map((value) => toTimescale(value, AV_MP4_VIDEO_TIMESCALE));
  const audioDurations = timelineDurations(audioChunks)
    .map((value) => toTimescale(value, AV_MP4_OPUS_SAMPLE_RATE));
  const videoSizes = videoChunks.map((chunk) => chunk.data.byteLength);
  const audioSizes = audioChunks.map((chunk) => chunk.data.byteLength);
  const syncSamples = videoChunks
    .map((chunk, index) => chunk.key ? index + 1 : 0)
    .filter((sample) => sample > 0);

  const header = ftyp();
  const placeholder = moov(
    width, height, numberOfChannels, avcC,
    videoDurations, videoSizes, syncSamples,
    audioDurations, audioSizes, 0, 0,
  );
  const videoBytes = concat(videoChunks.map((chunk) => chunk.data));
  const audioBytes = concat(audioChunks.map((chunk) => chunk.data));
  const videoOffset = header.byteLength + placeholder.byteLength + 8;
  const audioOffset = videoOffset + videoBytes.byteLength;
  if (audioOffset > UINT32_MAX || audioOffset + audioBytes.byteLength > UINT32_MAX) {
    throw new Mp4ExportError("MP4_EXPORT_FILE_TOO_LARGE", "MP4 exceeds 32-bit chunk offsets.");
  }

  const metadata = moov(
    width, height, numberOfChannels, avcC,
    videoDurations, videoSizes, syncSamples,
    audioDurations, audioSizes, videoOffset, audioOffset,
  );
  if (metadata.byteLength !== placeholder.byteLength) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", "MP4 metadata size changed while resolving offsets.");
  }
  return concat([header, metadata, box("mdat", videoBytes, audioBytes)]);
}

function validateExportOptions(options: AvcOpusMp4ExportOptions): void {
  validateMuxConfig(
    options.width,
    options.height,
    options.numberOfChannels,
    new Uint8Array([1, 0, 0, 0, 0, 0, 0]),
  );
  if (!Number.isFinite(options.frameRate) || options.frameRate <= 0 || options.frameRate > 240) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_CONFIG", `Invalid frame rate ${options.frameRate}.`);
  }
  if (!Number.isInteger(options.frameCount) || options.frameCount <= 0 || options.frameCount > 1_000_000) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_CONFIG", `Invalid frame count ${options.frameCount}.`);
  }
  if (!Number.isInteger(options.totalAudioFrames) || options.totalAudioFrames <= 0) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_CONFIG", `Invalid total audio frames ${options.totalAudioFrames}.`);
  }
  for (const [name, value] of [
    ["video bitrate", options.videoBitrate],
    ["audio bitrate", options.audioBitrate],
    ["key-frame interval", options.keyFrameIntervalFrames],
    ["audio chunk frames", options.audioChunkFrames],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new Mp4ExportError("MP4_EXPORT_INVALID_CONFIG", `Invalid ${name} ${value}.`);
    }
  }
}

function copyDescription(description: AllowSharedBufferSource): Uint8Array {
  if (ArrayBuffer.isView(description)) {
    return new Uint8Array(
      new Uint8Array(description.buffer, description.byteOffset, description.byteLength),
    );
  }
  return new Uint8Array(description).slice();
}

export async function exportAvcOpusMp4(options: AvcOpusMp4ExportOptions): Promise<AvcOpusMp4ExportResult> {
  validateExportOptions(options);
  if (
    typeof VideoEncoder === "undefined"
    || typeof VideoFrame === "undefined"
    || typeof AudioEncoder === "undefined"
    || typeof AudioData === "undefined"
  ) {
    throw new Mp4ExportError(
      "MP4_EXPORT_WEBCODECS_UNAVAILABLE",
      "WebCodecs video/audio encoders are unavailable in this browser.",
    );
  }

  const videoConfig: VideoEncoderConfig = {
    codec: AV_MP4_VIDEO_CODEC,
    width: options.width,
    height: options.height,
    bitrate: options.videoBitrate
      ?? Math.max(300_000, Math.round(options.width * options.height * options.frameRate * 0.12)),
    framerate: options.frameRate,
    latencyMode: "realtime",
    avc: { format: "avc" },
  };
  const videoSupport = await VideoEncoder.isConfigSupported(videoConfig);
  if (!videoSupport.supported) {
    throw new Mp4ExportError(
      "MP4_EXPORT_VIDEO_CODEC_UNSUPPORTED",
      `Browser does not support H.264 for ${options.width}x${options.height} @ ${options.frameRate} fps.`,
    );
  }

  const audioConfig: AudioEncoderConfig = {
    codec: AV_MP4_AUDIO_CODEC,
    sampleRate: AV_MP4_OPUS_SAMPLE_RATE,
    numberOfChannels: options.numberOfChannels,
    bitrate: options.audioBitrate ?? 64_000 * options.numberOfChannels,
  };
  const audioSupport = await AudioEncoder.isConfigSupported(audioConfig);
  if (!audioSupport.supported) {
    throw new Mp4ExportError(
      "MP4_EXPORT_AUDIO_CODEC_UNSUPPORTED",
      "Browser does not support native Opus encoding at 48 kHz.",
    );
  }

  const frameDurationUs = Math.max(1, Math.round(1_000_000 / options.frameRate));
  const keyFrameInterval = options.keyFrameIntervalFrames ?? Math.max(1, Math.round(options.frameRate * 2));
  const videoChunks: AvcMp4MuxChunk[] = [];
  let avcC: Uint8Array | null = null;
  let videoFailureMessage: string | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      videoChunks.push({
        timestampUs: chunk.timestamp,
        durationUs: chunk.duration ?? frameDurationUs,
        key: chunk.type === "key",
        data,
      });
      const description = metadata?.decoderConfig?.description;
      if (description !== undefined && avcC === null) avcC = copyDescription(description);
    },
    error: (error) => {
      videoFailureMessage = error.message;
    },
  });

  try {
    videoEncoder.configure(videoSupport.config ?? videoConfig);
    for (let frameIndex = 0; frameIndex < options.frameCount; frameIndex += 1) {
      const timestampUs = frameIndex * frameDurationUs;
      const frame = await options.createFrame(frameIndex, timestampUs, frameDurationUs);
      if (!(frame instanceof VideoFrame)) {
        throw new Mp4ExportError("MP4_EXPORT_INVALID_VIDEO_FRAME", "createFrame() must return VideoFrame.");
      }
      try {
        videoEncoder.encode(frame, {
          keyFrame: frameIndex === 0 || frameIndex % keyFrameInterval === 0,
        });
      } finally {
        frame.close();
      }
      if (videoEncoder.encodeQueueSize > 8) await videoEncoder.flush();
      if (videoFailureMessage !== null) {
        throw new Mp4ExportError("MP4_EXPORT_VIDEO_ENCODER_FAILED", videoFailureMessage);
      }
    }
    await videoEncoder.flush();
  } catch (error) {
    if (error instanceof Mp4ExportError) throw error;
    throw new Mp4ExportError(
      "MP4_EXPORT_VIDEO_ENCODER_FAILED",
      error instanceof Error ? error.message : "H.264 encoder failed.",
      error instanceof Error ? { cause: error } : undefined,
    );
  } finally {
    videoEncoder.close();
  }
  if (videoFailureMessage !== null) {
    throw new Mp4ExportError("MP4_EXPORT_VIDEO_ENCODER_FAILED", videoFailureMessage);
  }
  if (videoChunks.length === 0 || avcC === null) {
    throw new Mp4ExportError(
      "MP4_EXPORT_VIDEO_ENCODER_FAILED",
      "H.264 encoder produced no usable chunks/decoder configuration.",
    );
  }
  videoChunks.sort((left, right) => left.timestampUs - right.timestampUs);

  const audioChunkFrames = options.audioChunkFrames ?? DEFAULT_AUDIO_CHUNK_FRAMES;
  const fallbackAudioDurationUs = Math.max(
    1,
    Math.round(audioChunkFrames * 1_000_000 / AV_MP4_OPUS_SAMPLE_RATE),
  );
  const audioChunks: OpusMp4MuxChunk[] = [];
  let nextAudioTimestampUs = 0;
  let audioFailureMessage: string | null = null;
  const audioEncoder = new AudioEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const durationUs = chunk.duration ?? fallbackAudioDurationUs;
      audioChunks.push({
        timestampUs: nextAudioTimestampUs,
        durationUs,
        data,
      });
      nextAudioTimestampUs += durationUs;
    },
    error: (error) => {
      audioFailureMessage = error.message;
    },
  });

  try {
    audioEncoder.configure(audioSupport.config ?? audioConfig);
    for (let startFrame = 0; startFrame < options.totalAudioFrames; startFrame += audioChunkFrames) {
      const frameCount = Math.min(audioChunkFrames, options.totalAudioFrames - startFrame);
      const timestampUs = Math.round(startFrame * 1_000_000 / AV_MP4_OPUS_SAMPLE_RATE);
      const audioData = await options.createAudioData(startFrame, frameCount, timestampUs);
      if (!(audioData instanceof AudioData)) {
        throw new Mp4ExportError("MP4_EXPORT_INVALID_AUDIO_DATA", "createAudioData() must return AudioData.");
      }
      try {
        if (
          audioData.sampleRate !== AV_MP4_OPUS_SAMPLE_RATE
          || audioData.numberOfChannels !== options.numberOfChannels
          || audioData.numberOfFrames !== frameCount
          || audioData.timestamp !== timestampUs
        ) {
          throw new Mp4ExportError(
            "MP4_EXPORT_INVALID_AUDIO_DATA",
            `AudioData does not match requested 48 kHz / ${options.numberOfChannels} channel(s) / ${frameCount} frames / ${timestampUs} us.`,
          );
        }
        audioEncoder.encode(audioData);
      } finally {
        audioData.close();
      }
      if (audioEncoder.encodeQueueSize > 12) await audioEncoder.flush();
      if (audioFailureMessage !== null) {
        throw new Mp4ExportError("MP4_EXPORT_AUDIO_ENCODER_FAILED", audioFailureMessage);
      }
    }
    await audioEncoder.flush();
  } catch (error) {
    if (error instanceof Mp4ExportError) throw error;
    throw new Mp4ExportError(
      "MP4_EXPORT_AUDIO_ENCODER_FAILED",
      error instanceof Error ? error.message : "Opus encoder failed.",
      error instanceof Error ? { cause: error } : undefined,
    );
  } finally {
    audioEncoder.close();
  }
  if (audioFailureMessage !== null) {
    throw new Mp4ExportError("MP4_EXPORT_AUDIO_ENCODER_FAILED", audioFailureMessage);
  }
  if (audioChunks.length === 0) {
    throw new Mp4ExportError("MP4_EXPORT_AUDIO_ENCODER_FAILED", "Opus encoder produced no chunks.");
  }

  const videoDurationUs = options.frameCount * frameDurationUs;
  const audioDurationUs = Math.round(options.totalAudioFrames * 1_000_000 / AV_MP4_OPUS_SAMPLE_RATE);
  return {
    bytes: muxAvcOpusMp4(
      options.width,
      options.height,
      options.numberOfChannels,
      avcC,
      videoChunks,
      audioChunks,
    ),
    mimeType: AV_MP4_MIME_TYPE,
    videoCodec: AV_MP4_VIDEO_CODEC,
    audioCodec: AV_MP4_AUDIO_CODEC,
    width: options.width,
    height: options.height,
    frameRate: options.frameRate,
    frameCount: options.frameCount,
    sampleRate: AV_MP4_OPUS_SAMPLE_RATE,
    numberOfChannels: options.numberOfChannels,
    totalAudioFrames: options.totalAudioFrames,
    durationUs: Math.max(videoDurationUs, audioDurationUs),
    encodedVideoChunks: videoChunks.length,
    encodedAudioChunks: audioChunks.length,
  };
}

export function hasAvcOpusMp4Header(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12
    && bytes[4] === 0x66
    && bytes[5] === 0x74
    && bytes[6] === 0x79
    && bytes[7] === 0x70;
}
