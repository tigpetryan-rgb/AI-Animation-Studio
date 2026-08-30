import {
  AV_MP4_AUDIO_CODEC,
  AV_MP4_MIME_TYPE,
  AV_MP4_OPUS_PRE_SKIP,
  AV_MP4_OPUS_SAMPLE_RATE,
  AV_MP4_VIDEO_CODEC,
  AV_MP4_VIDEO_TIMESCALE,
  Mp4ExportError,
} from "./mp4-core.js";

const UINT32_MAX = 0xffff_ffff;
const DEFAULT_AUDIO_CHUNK_FRAMES = 960;
const DEFAULT_FRAGMENT_SECONDS = 1;
const utf8 = new TextEncoder();

export interface FragmentedMp4ByteSink {
  write(bytes: Uint8Array): void | Promise<void>;
}

export interface FragmentedMp4Sample {
  readonly duration: number;
  readonly data: Uint8Array;
  readonly key?: boolean;
}

export interface AvcOpusFragmentedMp4ExportOptions {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly frameCount: number;
  readonly videoBitrate?: number;
  readonly keyFrameIntervalFrames?: number;
  readonly fragmentDurationSeconds?: number;
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
  readonly sink: FragmentedMp4ByteSink;
  readonly signal?: AbortSignal;
}

export interface AvcOpusFragmentedMp4ExportResult {
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
  readonly fragmentsWritten: number;
  readonly bytesWritten: number;
}

interface EncodedVideoSample {
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly key: boolean;
  readonly data: Uint8Array;
}

interface EncodedAudioSample {
  readonly timestampUs: number;
  readonly durationUs: number;
  readonly data: Uint8Array;
}

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
  if (value.length !== 4) throw new RangeError(`Invalid fourcc ${value}.`);
  return utf8.encode(value);
}

function u16(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError(`Invalid uint16 ${value}.`);
  const output = new Uint8Array(2);
  new DataView(output.buffer).setUint16(0, value, false);
  return output;
}

function u32(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) throw new RangeError(`Invalid uint32 ${value}.`);
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, false);
  return output;
}

function u64(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid uint64 ${value}.`);
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigUint64(0, BigInt(value), false);
  return output;
}

function box(type: string, ...parts: readonly Uint8Array[]): Uint8Array {
  const payloadLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (payloadLength + 8 > UINT32_MAX) throw new RangeError(`${type} exceeds 32-bit box size.`);
  return concat([u32(payloadLength + 8), fourcc(type), ...parts]);
}

function fullBox(type: string, version: number, flags: number, ...parts: readonly Uint8Array[]): Uint8Array {
  if (!Number.isInteger(version) || version < 0 || version > 0xff) throw new RangeError(`Invalid box version ${version}.`);
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xff_ffff) throw new RangeError(`Invalid box flags ${flags}.`);
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
    fourcc("iso6"),
    u32(1),
    fourcc("isom"),
    fourcc("iso6"),
    fourcc("avc1"),
    fourcc("mp41"),
  );
}

function mvhd(): Uint8Array {
  return fullBox(
    "mvhd", 0, 0,
    u32(0), u32(0), u32(1_000), u32(0),
    u32(0x0001_0000), u16(0x0100), u16(0), zeros(8),
    matrix(), zeros(24), u32(3),
  );
}

function tkhd(trackId: number, width: number, height: number, volume: number): Uint8Array {
  return fullBox(
    "tkhd", 0, 0x000007,
    u32(0), u32(0), u32(trackId), u32(0), u32(0), zeros(8),
    u16(0), u16(0), u16(volume), u16(0), matrix(),
    u32(width * 65_536), u32(height * 65_536),
  );
}

function mdhd(timescale: number): Uint8Array {
  return fullBox("mdhd", 0, 0, u32(0), u32(0), u32(timescale), u32(0), languageUnd(), u16(0));
}

function hdlr(type: "vide" | "soun", name: string): Uint8Array {
  return fullBox("hdlr", 0, 0, u32(0), fourcc(type), zeros(12), concat([utf8.encode(name), new Uint8Array([0])]));
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

function emptySampleTable(sampleEntry: Uint8Array): Uint8Array {
  return box(
    "stbl",
    fullBox("stsd", 0, 0, u32(1), sampleEntry),
    fullBox("stts", 0, 0, u32(0)),
    fullBox("stsc", 0, 0, u32(0)),
    fullBox("stsz", 0, 0, u32(0), u32(0)),
    fullBox("stco", 0, 0, u32(0)),
  );
}

function videoTrak(width: number, height: number, avcC: Uint8Array): Uint8Array {
  return box(
    "trak",
    tkhd(1, width, height, 0),
    box(
      "mdia",
      mdhd(AV_MP4_VIDEO_TIMESCALE),
      hdlr("vide", "VideoHandler"),
      box("minf", vmhd(), dinf(), emptySampleTable(avc1(width, height, avcC))),
    ),
  );
}

function audioTrak(channels: 1 | 2): Uint8Array {
  return box(
    "trak",
    tkhd(2, 0, 0, 0x0100),
    box(
      "mdia",
      mdhd(AV_MP4_OPUS_SAMPLE_RATE),
      hdlr("soun", "SoundHandler"),
      box("minf", smhd(), dinf(), emptySampleTable(opus(channels))),
    ),
  );
}

function trex(trackId: number): Uint8Array {
  return fullBox("trex", 0, 0, u32(trackId), u32(1), u32(0), u32(0), u32(0));
}

function moov(width: number, height: number, channels: 1 | 2, avcC: Uint8Array): Uint8Array {
  return box("moov", mvhd(), videoTrak(width, height, avcC), audioTrak(channels), box("mvex", trex(1), trex(2)));
}

function validateInitConfig(width: number, height: number, channels: number, avcC: Uint8Array): asserts channels is 1 | 2 {
  if (!Number.isInteger(width) || width <= 0 || width > 16_384) throw new RangeError(`Invalid width ${width}.`);
  if (!Number.isInteger(height) || height <= 0 || height > 16_384) throw new RangeError(`Invalid height ${height}.`);
  if (channels !== 1 && channels !== 2) throw new RangeError(`Invalid channel count ${channels}.`);
  if (avcC.byteLength < 7 || avcC[0] !== 1) throw new RangeError("Invalid AVCDecoderConfigurationRecord (avcC).");
}

export function createAvcOpusFragmentedMp4InitSegment(
  width: number,
  height: number,
  channels: 1 | 2,
  avcC: Uint8Array,
): Uint8Array {
  validateInitConfig(width, height, channels, avcC);
  return concat([ftyp(), moov(width, height, channels, avcC)]);
}

function sampleFlags(sample: FragmentedMp4Sample): number {
  return sample.key === true ? 0x0200_0000 : 0x0101_0000;
}

function trun(samples: readonly FragmentedMp4Sample[], dataOffset: number, includeFlags: boolean): Uint8Array {
  const flags = 0x000001 | 0x000100 | 0x000200 | (includeFlags ? 0x000400 : 0);
  const rows = samples.flatMap((sample) => {
    if (!Number.isInteger(sample.duration) || sample.duration <= 0 || sample.duration > UINT32_MAX) {
      throw new RangeError(`Invalid fragment sample duration ${sample.duration}.`);
    }
    if (sample.data.byteLength <= 0 || sample.data.byteLength > UINT32_MAX) {
      throw new RangeError(`Invalid fragment sample size ${sample.data.byteLength}.`);
    }
    const values = [u32(sample.duration), u32(sample.data.byteLength)];
    if (includeFlags) values.push(u32(sampleFlags(sample)));
    return values;
  });
  return fullBox("trun", 0, flags, u32(samples.length), u32(dataOffset), ...rows);
}

function traf(trackId: number, baseDecodeTime: number, samples: readonly FragmentedMp4Sample[], dataOffset: number): Uint8Array {
  const includeFlags = trackId === 1;
  return box(
    "traf",
    fullBox("tfhd", 0, 0x020000, u32(trackId)),
    fullBox("tfdt", 1, 0, u64(baseDecodeTime)),
    trun(samples, dataOffset, includeFlags),
  );
}

function fragment(
  sequenceNumber: number,
  trackId: 1 | 2,
  baseDecodeTime: number,
  samples: readonly FragmentedMp4Sample[],
): Uint8Array {
  if (!Number.isInteger(sequenceNumber) || sequenceNumber <= 0 || sequenceNumber > UINT32_MAX) {
    throw new RangeError(`Invalid fragment sequence ${sequenceNumber}.`);
  }
  if (!Number.isSafeInteger(baseDecodeTime) || baseDecodeTime < 0) {
    throw new RangeError(`Invalid base decode time ${baseDecodeTime}.`);
  }
  if (samples.length === 0) throw new RangeError("A fragment needs at least one sample.");

  const placeholder = box("moof", fullBox("mfhd", 0, 0, u32(sequenceNumber)), traf(trackId, baseDecodeTime, samples, 0));
  const dataOffset = placeholder.byteLength + 8;
  const moof = box("moof", fullBox("mfhd", 0, 0, u32(sequenceNumber)), traf(trackId, baseDecodeTime, samples, dataOffset));
  if (moof.byteLength !== placeholder.byteLength) throw new RangeError("Fragment metadata changed while resolving data offset.");
  return concat([moof, box("mdat", ...samples.map((sample) => sample.data))]);
}

export function createAvcFragmentedMp4Fragment(
  sequenceNumber: number,
  baseDecodeTime: number,
  samples: readonly FragmentedMp4Sample[],
): Uint8Array {
  if (samples.some((sample) => sample.key === undefined)) {
    throw new RangeError("Video fragment samples must declare key=true/false.");
  }
  return fragment(sequenceNumber, 1, baseDecodeTime, samples);
}

export function createOpusFragmentedMp4Fragment(
  sequenceNumber: number,
  baseDecodeTime: number,
  samples: readonly FragmentedMp4Sample[],
): Uint8Array {
  return fragment(sequenceNumber, 2, baseDecodeTime, samples);
}

function copyDescription(description: AllowSharedBufferSource): Uint8Array {
  if (ArrayBuffer.isView(description)) {
    return new Uint8Array(new Uint8Array(description.buffer, description.byteOffset, description.byteLength));
  }
  return new Uint8Array(description).slice();
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Export aborted.", "AbortError");
}

function toTimescale(durationUs: number, timescale: number): number {
  return Math.max(1, Math.round(durationUs * timescale / 1_000_000));
}

function validateExportOptions(options: AvcOpusFragmentedMp4ExportOptions): void {
  validateInitConfig(options.width, options.height, options.numberOfChannels, new Uint8Array([1, 0, 0, 0, 0, 0, 0]));
  if (!Number.isFinite(options.frameRate) || options.frameRate <= 0 || options.frameRate > 240) {
    throw new RangeError(`Invalid frame rate ${options.frameRate}.`);
  }
  if (!Number.isInteger(options.frameCount) || options.frameCount <= 0) throw new RangeError(`Invalid frame count ${options.frameCount}.`);
  if (!Number.isInteger(options.totalAudioFrames) || options.totalAudioFrames <= 0) {
    throw new RangeError(`Invalid total audio frames ${options.totalAudioFrames}.`);
  }
  if (options.fragmentDurationSeconds !== undefined && (!Number.isFinite(options.fragmentDurationSeconds) || options.fragmentDurationSeconds <= 0)) {
    throw new RangeError(`Invalid fragment duration ${options.fragmentDurationSeconds}.`);
  }
}

export async function exportAvcOpusFragmentedMp4(
  options: AvcOpusFragmentedMp4ExportOptions,
): Promise<AvcOpusFragmentedMp4ExportResult> {
  validateExportOptions(options);
  if (
    typeof VideoEncoder === "undefined"
    || typeof VideoFrame === "undefined"
    || typeof AudioEncoder === "undefined"
    || typeof AudioData === "undefined"
  ) {
    throw new Mp4ExportError("MP4_EXPORT_WEBCODECS_UNAVAILABLE", "WebCodecs video/audio encoders are unavailable in this browser.");
  }

  const videoConfig: VideoEncoderConfig = {
    codec: AV_MP4_VIDEO_CODEC,
    width: options.width,
    height: options.height,
    bitrate: options.videoBitrate ?? Math.max(300_000, Math.round(options.width * options.height * options.frameRate * 0.12)),
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
    throw new Mp4ExportError("MP4_EXPORT_AUDIO_CODEC_UNSUPPORTED", "Browser does not support native Opus encoding at 48 kHz.");
  }

  const frameDurationUs = Math.max(1, Math.round(1_000_000 / options.frameRate));
  const keyFrameInterval = options.keyFrameIntervalFrames ?? Math.max(1, Math.round(options.frameRate * 2));
  const fragmentSeconds = options.fragmentDurationSeconds ?? DEFAULT_FRAGMENT_SECONDS;
  const videoBatchFrames = Math.max(1, Math.round(options.frameRate * fragmentSeconds));
  const audioChunkFrames = options.audioChunkFrames ?? DEFAULT_AUDIO_CHUNK_FRAMES;
  const audioBatchFrames = Math.max(audioChunkFrames, Math.round(AV_MP4_OPUS_SAMPLE_RATE * fragmentSeconds));
  const fallbackAudioDurationUs = Math.max(1, Math.round(audioChunkFrames * 1_000_000 / AV_MP4_OPUS_SAMPLE_RATE));

  let bytesWritten = 0;
  let fragmentsWritten = 0;
  let sequenceNumber = 1;
  let videoDecodeTime = 0;
  let audioDecodeTime = 0;
  let encodedVideoChunks = 0;
  let encodedAudioChunks = 0;
  let avcC: Uint8Array | null = null;
  let videoFailureMessage: string | null = null;
  let audioFailureMessage: string | null = null;
  let pendingVideo: EncodedVideoSample[] = [];
  let pendingAudio: EncodedAudioSample[] = [];
  let nextAudioTimestampUs = 0;

  const write = async (bytes: Uint8Array): Promise<void> => {
    throwIfAborted(options.signal);
    await options.sink.write(bytes);
    bytesWritten += bytes.byteLength;
    throwIfAborted(options.signal);
  };

  const videoEncoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      pendingVideo.push({
        timestampUs: chunk.timestamp,
        durationUs: chunk.duration ?? frameDurationUs,
        key: chunk.type === "key",
        data,
      });
      const description = metadata?.decoderConfig?.description;
      if (description !== undefined && avcC === null) avcC = copyDescription(description);
    },
    error: (error) => { videoFailureMessage = error.message; },
  });

  const flushVideoFragment = async (): Promise<void> => {
    await videoEncoder.flush();
    if (videoFailureMessage !== null) throw new Mp4ExportError("MP4_EXPORT_VIDEO_ENCODER_FAILED", videoFailureMessage);
    if (pendingVideo.length === 0) return;
    pendingVideo.sort((left, right) => left.timestampUs - right.timestampUs);
    if (avcC === null) {
      throw new Mp4ExportError("MP4_EXPORT_VIDEO_ENCODER_FAILED", "H.264 encoder produced no decoder configuration.");
    }
    if (bytesWritten === 0) await write(createAvcOpusFragmentedMp4InitSegment(options.width, options.height, options.numberOfChannels, avcC));
    const samples = pendingVideo.map<FragmentedMp4Sample>((sample) => ({
      duration: toTimescale(sample.durationUs, AV_MP4_VIDEO_TIMESCALE),
      data: sample.data,
      key: sample.key,
    }));
    await write(createAvcFragmentedMp4Fragment(sequenceNumber, videoDecodeTime, samples));
    sequenceNumber += 1;
    fragmentsWritten += 1;
    encodedVideoChunks += samples.length;
    videoDecodeTime += samples.reduce((sum, sample) => sum + sample.duration, 0);
    pendingVideo = [];
  };

  try {
    videoEncoder.configure(videoSupport.config ?? videoConfig);
    for (let frameIndex = 0; frameIndex < options.frameCount; frameIndex += 1) {
      throwIfAborted(options.signal);
      const timestampUs = frameIndex * frameDurationUs;
      const frame = await options.createFrame(frameIndex, timestampUs, frameDurationUs);
      if (!(frame instanceof VideoFrame)) {
        throw new Mp4ExportError("MP4_EXPORT_INVALID_VIDEO_FRAME", "createFrame() must return VideoFrame.");
      }
      try {
        videoEncoder.encode(frame, { keyFrame: frameIndex === 0 || frameIndex % keyFrameInterval === 0 });
      } finally {
        frame.close();
      }
      if ((frameIndex + 1) % videoBatchFrames === 0) await flushVideoFragment();
    }
    await flushVideoFragment();
  } catch (error) {
    if (error instanceof Mp4ExportError || error instanceof DOMException) throw error;
    throw new Mp4ExportError(
      "MP4_EXPORT_VIDEO_ENCODER_FAILED",
      error instanceof Error ? error.message : "H.264 encoder failed.",
      error instanceof Error ? { cause: error } : undefined,
    );
  } finally {
    videoEncoder.close();
    pendingVideo = [];
  }

  const audioEncoder = new AudioEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const durationUs = chunk.duration ?? fallbackAudioDurationUs;
      pendingAudio.push({ timestampUs: nextAudioTimestampUs, durationUs, data });
      nextAudioTimestampUs += durationUs;
    },
    error: (error) => { audioFailureMessage = error.message; },
  });

  const flushAudioFragment = async (): Promise<void> => {
    await audioEncoder.flush();
    if (audioFailureMessage !== null) throw new Mp4ExportError("MP4_EXPORT_AUDIO_ENCODER_FAILED", audioFailureMessage);
    if (pendingAudio.length === 0) return;
    pendingAudio.sort((left, right) => left.timestampUs - right.timestampUs);
    const samples = pendingAudio.map<FragmentedMp4Sample>((sample) => ({
      duration: toTimescale(sample.durationUs, AV_MP4_OPUS_SAMPLE_RATE),
      data: sample.data,
    }));
    await write(createOpusFragmentedMp4Fragment(sequenceNumber, audioDecodeTime, samples));
    sequenceNumber += 1;
    fragmentsWritten += 1;
    encodedAudioChunks += samples.length;
    audioDecodeTime += samples.reduce((sum, sample) => sum + sample.duration, 0);
    pendingAudio = [];
  };

  try {
    audioEncoder.configure(audioSupport.config ?? audioConfig);
    for (let batchStart = 0; batchStart < options.totalAudioFrames; batchStart += audioBatchFrames) {
      const batchEnd = Math.min(options.totalAudioFrames, batchStart + audioBatchFrames);
      for (let startFrame = batchStart; startFrame < batchEnd; startFrame += audioChunkFrames) {
        throwIfAborted(options.signal);
        const frameCount = Math.min(audioChunkFrames, batchEnd - startFrame);
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
      }
      await flushAudioFragment();
    }
  } catch (error) {
    if (error instanceof Mp4ExportError || error instanceof DOMException) throw error;
    throw new Mp4ExportError(
      "MP4_EXPORT_AUDIO_ENCODER_FAILED",
      error instanceof Error ? error.message : "Opus encoder failed.",
      error instanceof Error ? { cause: error } : undefined,
    );
  } finally {
    audioEncoder.close();
    pendingAudio = [];
  }

  if (bytesWritten === 0 || encodedVideoChunks === 0 || encodedAudioChunks === 0) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", "Fragmented export produced no usable media.");
  }

  const videoDurationUs = options.frameCount * frameDurationUs;
  const audioDurationUs = Math.round(options.totalAudioFrames * 1_000_000 / AV_MP4_OPUS_SAMPLE_RATE);
  return {
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
    encodedVideoChunks,
    encodedAudioChunks,
    fragmentsWritten,
    bytesWritten,
  };
}

export function hasAvcOpusFragmentedMp4Header(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12
    && bytes[4] === 0x66
    && bytes[5] === 0x74
    && bytes[6] === 0x79
    && bytes[7] === 0x70;
}
