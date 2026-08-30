import {
  AV_MP4_VIDEO_CODEC,
  AV_MP4_VIDEO_TIMESCALE,
  Mp4ExportError,
} from "./mp4-core.js";
import type { FragmentedMp4ByteSink } from "./fragmented-mp4-core.js";

export const AV_MP4_AAC_AUDIO_CODEC = "mp4a.40.2" as const;
export const AV_MP4_AAC_MIME_TYPE = 'video/mp4;codecs="avc1.42001E,mp4a.40.2"' as const;

const UINT32_MAX = 0xffff_ffff;
const DEFAULT_AAC_CHUNK_FRAMES = 1024;
const DEFAULT_FRAGMENT_SECONDS = 1;
const utf8 = new TextEncoder();

export interface AvcAacFragmentedMp4ExportOptions {
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
  readonly sampleRate: number;
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

export interface AvcAacFragmentedMp4ExportResult {
  readonly mimeType: typeof AV_MP4_AAC_MIME_TYPE;
  readonly videoCodec: typeof AV_MP4_VIDEO_CODEC;
  readonly audioCodec: typeof AV_MP4_AAC_AUDIO_CODEC;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly frameCount: number;
  readonly sampleRate: number;
  readonly numberOfChannels: 1 | 2;
  readonly totalAudioFrames: number;
  readonly durationUs: number;
  readonly encodedVideoChunks: number;
  readonly encodedAudioChunks: number;
  readonly fragmentsWritten: number;
  readonly bytesWritten: number;
}

interface FragmentSample {
  readonly duration: number;
  readonly data: Uint8Array;
  readonly key?: boolean;
}

interface EncodedVideoSample {
  readonly durationUs: number;
  readonly key: boolean;
  readonly data: Uint8Array;
}

interface EncodedAudioSample {
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

function descriptorLength(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0 || length > 0x0fff_ffff) {
    throw new RangeError(`Invalid MPEG-4 descriptor length ${length}.`);
  }
  const bytes: number[] = [length & 0x7f];
  let remaining = length >>> 7;
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  return new Uint8Array(bytes);
}

function descriptor(tag: number, payload: Uint8Array): Uint8Array {
  return concat([new Uint8Array([tag]), descriptorLength(payload.byteLength), payload]);
}

const AAC_SAMPLE_RATES = [96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000, 7_350] as const;

export function createAacAudioSpecificConfig(sampleRate: number, channels: 1 | 2): Uint8Array {
  const frequencyIndex = AAC_SAMPLE_RATES.indexOf(sampleRate as (typeof AAC_SAMPLE_RATES)[number]);
  if (frequencyIndex < 0) throw new RangeError(`AAC-LC sample rate ${sampleRate} is not supported by this MP4 path.`);
  const bits = (2 << 11) | (frequencyIndex << 7) | (channels << 3);
  return new Uint8Array([(bits >>> 8) & 0xff, bits & 0xff]);
}

function esds(audioSpecificConfig: Uint8Array, bitrate: number): Uint8Array {
  const decoderSpecific = descriptor(0x05, audioSpecificConfig);
  const decoderConfig = descriptor(0x04, concat([
    new Uint8Array([0x40, 0x15, 0, 0, 0]),
    u32(bitrate),
    u32(bitrate),
    decoderSpecific,
  ]));
  const slConfig = descriptor(0x06, new Uint8Array([0x02]));
  const esDescriptor = descriptor(0x03, concat([u16(2), new Uint8Array([0]), decoderConfig, slConfig]));
  return fullBox("esds", 0, 0, esDescriptor);
}

function mp4a(sampleRate: number, channels: 1 | 2, audioSpecificConfig: Uint8Array, bitrate: number): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 48_000) {
    throw new RangeError(`Invalid AAC MP4 sample rate ${sampleRate}.`);
  }
  return box(
    "mp4a",
    zeros(6), u16(1), zeros(8),
    u16(channels), u16(16), u16(0), u16(0),
    u32(sampleRate * 65_536),
    esds(audioSpecificConfig, bitrate),
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

function audioTrak(sampleRate: number, channels: 1 | 2, audioSpecificConfig: Uint8Array, bitrate: number): Uint8Array {
  return box(
    "trak",
    tkhd(2, 0, 0, 0x0100),
    box(
      "mdia",
      mdhd(sampleRate),
      hdlr("soun", "SoundHandler"),
      box("minf", smhd(), dinf(), emptySampleTable(mp4a(sampleRate, channels, audioSpecificConfig, bitrate))),
    ),
  );
}

function trex(trackId: number): Uint8Array {
  return fullBox("trex", 0, 0, u32(trackId), u32(1), u32(0), u32(0), u32(0));
}

function moov(
  width: number,
  height: number,
  sampleRate: number,
  channels: 1 | 2,
  avcC: Uint8Array,
  audioSpecificConfig: Uint8Array,
  audioBitrate: number,
): Uint8Array {
  return box(
    "moov",
    mvhd(),
    videoTrak(width, height, avcC),
    audioTrak(sampleRate, channels, audioSpecificConfig, audioBitrate),
    box("mvex", trex(1), trex(2)),
  );
}

function validateInitConfig(
  width: number,
  height: number,
  sampleRate: number,
  channels: number,
  avcC: Uint8Array,
): asserts channels is 1 | 2 {
  if (!Number.isInteger(width) || width <= 0 || width > 16_384) throw new RangeError(`Invalid width ${width}.`);
  if (!Number.isInteger(height) || height <= 0 || height > 16_384) throw new RangeError(`Invalid height ${height}.`);
  if (channels !== 1 && channels !== 2) throw new RangeError(`Invalid channel count ${channels}.`);
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 48_000) throw new RangeError(`Invalid AAC sample rate ${sampleRate}.`);
  createAacAudioSpecificConfig(sampleRate, channels);
  if (avcC.byteLength < 7 || avcC[0] !== 1) throw new RangeError("Invalid AVCDecoderConfigurationRecord (avcC).");
}

export function createAvcAacFragmentedMp4InitSegment(
  width: number,
  height: number,
  sampleRate: number,
  channels: 1 | 2,
  avcC: Uint8Array,
  audioBitrate = 128_000,
): Uint8Array {
  validateInitConfig(width, height, sampleRate, channels, avcC);
  if (!Number.isInteger(audioBitrate) || audioBitrate <= 0) throw new RangeError(`Invalid AAC bitrate ${audioBitrate}.`);
  const asc = createAacAudioSpecificConfig(sampleRate, channels);
  return concat([ftyp(), moov(width, height, sampleRate, channels, avcC, asc, audioBitrate)]);
}

function sampleFlags(sample: FragmentSample): number {
  return sample.key === true ? 0x0200_0000 : 0x0101_0000;
}

function trun(samples: readonly FragmentSample[], dataOffset: number, includeFlags: boolean): Uint8Array {
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

function traf(trackId: 1 | 2, baseDecodeTime: number, samples: readonly FragmentSample[], dataOffset: number): Uint8Array {
  return box(
    "traf",
    fullBox("tfhd", 0, 0x020000, u32(trackId)),
    fullBox("tfdt", 1, 0, u64(baseDecodeTime)),
    trun(samples, dataOffset, trackId === 1),
  );
}

function fragment(
  sequenceNumber: number,
  trackId: 1 | 2,
  baseDecodeTime: number,
  samples: readonly FragmentSample[],
): Uint8Array {
  if (!Number.isInteger(sequenceNumber) || sequenceNumber <= 0 || sequenceNumber > UINT32_MAX) {
    throw new RangeError(`Invalid fragment sequence ${sequenceNumber}.`);
  }
  if (!Number.isSafeInteger(baseDecodeTime) || baseDecodeTime < 0) {
    throw new RangeError(`Invalid base decode time ${baseDecodeTime}.`);
  }
  if (samples.length === 0) throw new RangeError("A fragment needs at least one sample.");
  if (trackId === 1 && samples.some((sample) => sample.key === undefined)) {
    throw new RangeError("Video fragment samples must declare key=true/false.");
  }

  const placeholder = box("moof", fullBox("mfhd", 0, 0, u32(sequenceNumber)), traf(trackId, baseDecodeTime, samples, 0));
  const dataOffset = placeholder.byteLength + 8;
  const moof = box("moof", fullBox("mfhd", 0, 0, u32(sequenceNumber)), traf(trackId, baseDecodeTime, samples, dataOffset));
  if (moof.byteLength !== placeholder.byteLength) throw new RangeError("Fragment metadata changed while resolving data offset.");
  return concat([moof, box("mdat", ...samples.map((sample) => sample.data))]);
}

export function createAacFragmentedMp4Fragment(
  sequenceNumber: number,
  baseDecodeTime: number,
  samples: readonly { readonly duration: number; readonly data: Uint8Array }[],
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

function validateExportOptions(options: AvcAacFragmentedMp4ExportOptions): void {
  validateInitConfig(options.width, options.height, options.sampleRate, options.numberOfChannels, new Uint8Array([1, 0, 0, 0, 0, 0, 0]));
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
  for (const [name, value] of [
    ["video bitrate", options.videoBitrate],
    ["audio bitrate", options.audioBitrate],
    ["key-frame interval", options.keyFrameIntervalFrames],
    ["audio chunk frames", options.audioChunkFrames],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new RangeError(`Invalid ${name} ${value}.`);
    }
  }
}

export async function exportAvcAacFragmentedMp4(
  options: AvcAacFragmentedMp4ExportOptions,
): Promise<AvcAacFragmentedMp4ExportResult> {
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
  if (videoSupport.supported !== true) {
    throw new Mp4ExportError(
      "MP4_EXPORT_VIDEO_CODEC_UNSUPPORTED",
      `Browser does not support H.264 for ${options.width}x${options.height} @ ${options.frameRate} fps.`,
    );
  }

  const audioBitrate = options.audioBitrate ?? 96_000 * options.numberOfChannels;
  const audioConfig: AudioEncoderConfig = {
    codec: AV_MP4_AAC_AUDIO_CODEC,
    sampleRate: options.sampleRate,
    numberOfChannels: options.numberOfChannels,
    bitrate: audioBitrate,
  };
  const audioSupport = await AudioEncoder.isConfigSupported(audioConfig);
  if (audioSupport.supported !== true) {
    throw new Mp4ExportError("MP4_EXPORT_AUDIO_CODEC_UNSUPPORTED", "Browser does not support native AAC-LC encoding for this project audio profile.");
  }

  const frameDurationUs = Math.max(1, Math.round(1_000_000 / options.frameRate));
  const keyFrameInterval = options.keyFrameIntervalFrames ?? Math.max(1, Math.round(options.frameRate * 2));
  const fragmentSeconds = options.fragmentDurationSeconds ?? DEFAULT_FRAGMENT_SECONDS;
  const videoBatchFrames = Math.max(1, Math.round(options.frameRate * fragmentSeconds));
  const audioChunkFrames = options.audioChunkFrames ?? DEFAULT_AAC_CHUNK_FRAMES;
  const audioBatchFrames = Math.max(audioChunkFrames, Math.round(options.sampleRate * fragmentSeconds));
  const fallbackAudioDurationUs = Math.max(1, Math.round(DEFAULT_AAC_CHUNK_FRAMES * 1_000_000 / options.sampleRate));

  let bytesWritten = 0;
  let fragmentsWritten = 0;
  let sequenceNumber = 1;
  let videoDecodeTime = 0;
  let audioDecodeTime = 0;
  let encodedVideoChunks = 0;
  let encodedAudioChunks = 0;
  let avcC: Uint8Array | null = null;
  let encoderAacConfig: Uint8Array | null = null;
  let videoFailureMessage: string | null = null;
  let audioFailureMessage: string | null = null;
  let pendingVideo: EncodedVideoSample[] = [];
  let pendingAudio: EncodedAudioSample[] = [];

  const write = async (bytes: Uint8Array): Promise<void> => {
    throwIfAborted(options.signal);
    await options.sink.write(bytes);
    bytesWritten += bytes.byteLength;
    throwIfAborted(options.signal);
  };

  const ensureInit = async (): Promise<void> => {
    if (bytesWritten !== 0) return;
    if (avcC === null) throw new Mp4ExportError("MP4_EXPORT_VIDEO_ENCODER_FAILED", "H.264 encoder produced no decoder configuration.");
    const fallback = createAacAudioSpecificConfig(options.sampleRate, options.numberOfChannels);
    const audioSpecificConfig = encoderAacConfig !== null && encoderAacConfig.byteLength > 0 ? encoderAacConfig : fallback;
    await write(createAvcAacFragmentedMp4InitSegment(
      options.width,
      options.height,
      options.sampleRate,
      options.numberOfChannels,
      avcC,
      audioBitrate,
    ));
    void audioSpecificConfig;
  };

  const videoEncoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      pendingVideo.push({
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
    await ensureInit();
    const samples = pendingVideo.map<FragmentSample>((sample) => ({
      duration: toTimescale(sample.durationUs, AV_MP4_VIDEO_TIMESCALE),
      data: sample.data,
      key: sample.key,
    }));
    await write(fragment(sequenceNumber, 1, videoDecodeTime, samples));
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
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      pendingAudio.push({
        durationUs: chunk.duration ?? fallbackAudioDurationUs,
        data,
      });
      const description = metadata?.decoderConfig?.description;
      if (description !== undefined && encoderAacConfig === null) encoderAacConfig = copyDescription(description);
    },
    error: (error) => { audioFailureMessage = error.message; },
  });

  const flushAudioFragment = async (): Promise<void> => {
    await audioEncoder.flush();
    if (audioFailureMessage !== null) throw new Mp4ExportError("MP4_EXPORT_AUDIO_ENCODER_FAILED", audioFailureMessage);
    if (pendingAudio.length === 0) return;
    const samples = pendingAudio.map<FragmentSample>((sample) => ({
      duration: toTimescale(sample.durationUs, options.sampleRate),
      data: sample.data,
    }));
    await write(fragment(sequenceNumber, 2, audioDecodeTime, samples));
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
        const timestampUs = Math.round(startFrame * 1_000_000 / options.sampleRate);
        const audioData = await options.createAudioData(startFrame, frameCount, timestampUs);
        if (!(audioData instanceof AudioData)) {
          throw new Mp4ExportError("MP4_EXPORT_INVALID_AUDIO_DATA", "createAudioData() must return AudioData.");
        }
        try {
          if (
            audioData.sampleRate !== options.sampleRate
            || audioData.numberOfChannels !== options.numberOfChannels
            || audioData.numberOfFrames !== frameCount
            || audioData.timestamp !== timestampUs
          ) {
            throw new Mp4ExportError(
              "MP4_EXPORT_INVALID_AUDIO_DATA",
              `AudioData does not match requested ${options.sampleRate} Hz / ${options.numberOfChannels} channel(s) / ${frameCount} frames / ${timestampUs} us.`,
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
      error instanceof Error ? error.message : "AAC encoder failed.",
      error instanceof Error ? { cause: error } : undefined,
    );
  } finally {
    audioEncoder.close();
    pendingAudio = [];
  }

  if (bytesWritten === 0 || encodedVideoChunks === 0 || encodedAudioChunks === 0) {
    throw new Mp4ExportError("MP4_EXPORT_INVALID_CHUNK", "Fragmented AAC export produced no usable media.");
  }

  const videoDurationUs = options.frameCount * frameDurationUs;
  const audioDurationUs = Math.round(options.totalAudioFrames * 1_000_000 / options.sampleRate);
  return {
    mimeType: AV_MP4_AAC_MIME_TYPE,
    videoCodec: AV_MP4_VIDEO_CODEC,
    audioCodec: AV_MP4_AAC_AUDIO_CODEC,
    width: options.width,
    height: options.height,
    frameRate: options.frameRate,
    frameCount: options.frameCount,
    sampleRate: options.sampleRate,
    numberOfChannels: options.numberOfChannels,
    totalAudioFrames: options.totalAudioFrames,
    durationUs: Math.max(videoDurationUs, audioDurationUs),
    encodedVideoChunks,
    encodedAudioChunks,
    fragmentsWritten,
    bytesWritten,
  };
}

export function hasAvcAacFragmentedMp4Header(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12
    && bytes[4] === 0x66
    && bytes[5] === 0x74
    && bytes[6] === 0x79
    && bytes[7] === 0x70;
}
