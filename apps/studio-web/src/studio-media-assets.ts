import type {
  MovieAudioAsset,
  MovieTimelineAsset,
  MovieVideoAsset,
  MovieVideoFileAsset,
  StudioMovieSession,
} from "./studio-movie-session";

export interface PreparedVideoAsset {
  readonly element: HTMLVideoElement;
  readonly durationSeconds: number;
  readonly loop: boolean;
  close(): void;
}

export interface PreparedAudioAsset {
  readonly buffer: AudioBuffer;
  readonly gain: number;
  readonly loop: boolean;
}

export interface PreparedMovieMedia {
  readonly images: ReadonlyMap<string, ImageBitmap>;
  readonly videos: ReadonlyMap<string, PreparedVideoAsset>;
  readonly audio: ReadonlyMap<string, PreparedAudioAsset>;
  close(): void;
}

export interface MovieMediaLoadDependencies {
  readonly fetchAsset?: typeof fetch;
  readonly decodeImage?: (blob: Blob) => Promise<ImageBitmap>;
  readonly decodeVideo?: (blob: Blob, asset: MovieVideoFileAsset) => Promise<PreparedVideoAsset>;
  readonly decodeAudio?: (blob: Blob, asset: MovieAudioAsset, sampleRate: number) => Promise<AudioBuffer>;
  readonly baseUrl?: string;
}

function videoAssets(session: StudioMovieSession): readonly MovieVideoAsset[] {
  return Object.values(session.assets)
    .filter((asset): asset is MovieVideoAsset => asset.kind === "video")
    .sort((a, b) => a.id.localeCompare(b.id));
}

function audioAssets(session: StudioMovieSession): readonly MovieAudioAsset[] {
  return Object.values(session.assets)
    .filter((asset): asset is MovieAudioAsset => asset.kind === "audio")
    .sort((a, b) => a.id.localeCompare(b.id));
}

function requireBaseUrl(value?: string): string {
  if (value !== undefined) return value;
  if (typeof document !== "undefined") return document.baseURI;
  throw new Error("Movie media loading requires a base URL outside the browser document.");
}

function decodeBase64(value: string): Uint8Array {
  if (typeof atob !== "function") throw new Error("Base64 decoding is unavailable for movie media.");
  const compact = value.replace(/\s+/g, "");
  const binary = atob(compact);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function fetchMediaBlob(
  asset: MovieTimelineAsset,
  fetchAsset: typeof fetch,
  baseUrl: string,
): Promise<Blob> {
  const url = new URL(asset.uri, baseUrl);
  const response = await fetchAsset(url);
  if (!response.ok) throw new Error(`Failed to load media asset ${asset.id}: HTTP ${response.status}.`);

  if (asset.encoding === "base64") {
    const bytes = decodeBase64(await response.text());
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return new Blob([buffer], { type: asset.mimeType });
  }

  const blob = await response.blob();
  if (blob.type.length > 0 && blob.type !== asset.mimeType) {
    const expectedFamily = asset.mimeType.split("/", 1)[0];
    if (expectedFamily !== undefined && !blob.type.startsWith(`${expectedFamily}/`)) {
      throw new Error(`Media asset ${asset.id} returned unsupported content type ${blob.type}.`);
    }
  }
  return blob.type.length === 0 ? blob.slice(0, blob.size, asset.mimeType) : blob;
}

async function decodeBrowserImage(blob: Blob): Promise<ImageBitmap> {
  if (typeof document === "undefined" || typeof Image === "undefined") {
    throw new Error("DOM image decoding is unavailable for movie media.");
  }
  if (typeof createImageBitmap !== "function") {
    throw new Error("createImageBitmap is unavailable for movie media decoding.");
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "sync";
    image.src = objectUrl;
    await image.decode();
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      throw new Error("Decoded image has invalid natural dimensions.");
    }
    return createImageBitmap(image);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function waitForVideoEvent(video: HTMLVideoElement, successEvent: "loadedmetadata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      video.removeEventListener(successEvent, onSuccess);
      video.removeEventListener("error", onError);
    };
    const onSuccess = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error(video.error?.message ?? "Video media decode failed."));
    };
    video.addEventListener(successEvent, onSuccess, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function decodeBrowserVideo(blob: Blob, asset: MovieVideoFileAsset): Promise<PreparedVideoAsset> {
  if (typeof document === "undefined") throw new Error("DOM video decoding is unavailable for movie media.");
  const objectUrl = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  try {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      const ready = waitForVideoEvent(video, "loadedmetadata");
      video.load();
      await ready;
    }
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error(`Video asset ${asset.id} decoded with invalid duration.`);
    }
  } catch (error) {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
    throw error;
  }

  return Object.freeze({
    element: video,
    durationSeconds: video.duration,
    loop: asset.loop,
    close(): void {
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
    },
  });
}

async function decodeBrowserAudio(blob: Blob, asset: MovieAudioAsset, sampleRate: number): Promise<AudioBuffer> {
  if (typeof AudioContext === "undefined") throw new Error("Web Audio decoding is unavailable for movie media.");
  const context = new AudioContext({ sampleRate });
  try {
    const bytes = await blob.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    if (buffer.length <= 0 || buffer.duration <= 0 || buffer.numberOfChannels <= 0) {
      throw new Error(`Audio asset ${asset.id} decoded with invalid audio data.`);
    }
    return buffer;
  } finally {
    await context.close();
  }
}

export async function seekPreparedVideo(video: PreparedVideoAsset, sourceSeconds: number): Promise<void> {
  const duration = video.durationSeconds;
  if (!Number.isFinite(sourceSeconds)) throw new Error("Video source time must be finite.");
  const normalized = video.loop
    ? ((sourceSeconds % duration) + duration) % duration
    : Math.min(Math.max(sourceSeconds, 0), Math.max(0, duration - 0.001));
  const target = Math.min(normalized, Math.max(0, duration - 0.001));
  if (Math.abs(video.element.currentTime - target) < 0.0005 && video.element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }
  const ready = waitForVideoEvent(video.element, "seeked");
  video.element.currentTime = target;
  await ready;
}

export function samplePreparedAudio(asset: PreparedAudioAsset, sourceSeconds: number): number {
  const { buffer } = asset;
  if (!Number.isFinite(sourceSeconds) || buffer.duration <= 0 || buffer.length <= 0) return 0;
  let time = sourceSeconds;
  if (asset.loop) time = ((time % buffer.duration) + buffer.duration) % buffer.duration;
  if (time < 0 || time >= buffer.duration) return 0;

  const sourceFrame = time * buffer.sampleRate;
  const left = Math.min(buffer.length - 1, Math.max(0, Math.floor(sourceFrame)));
  const right = Math.min(buffer.length - 1, left + 1);
  const fraction = sourceFrame - left;
  let mixed = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    const a = data[left] ?? 0;
    const b = data[right] ?? a;
    mixed += a + (b - a) * fraction;
  }
  return mixed / buffer.numberOfChannels * asset.gain;
}

export async function prepareMovieMedia(
  session: StudioMovieSession,
  dependencies: MovieMediaLoadDependencies = {},
): Promise<PreparedMovieMedia> {
  const fetchAsset = dependencies.fetchAsset ?? globalThis.fetch;
  const decodeImage = dependencies.decodeImage ?? decodeBrowserImage;
  const decodeVideo = dependencies.decodeVideo ?? decodeBrowserVideo;
  const decodeAudio = dependencies.decodeAudio ?? decodeBrowserAudio;
  if (typeof fetchAsset !== "function") throw new Error("Fetch is unavailable for movie media loading.");

  const baseUrl = requireBaseUrl(dependencies.baseUrl);
  const images = new Map<string, ImageBitmap>();
  const videos = new Map<string, PreparedVideoAsset>();
  const audio = new Map<string, PreparedAudioAsset>();

  try {
    for (const asset of videoAssets(session)) {
      const blob = await fetchMediaBlob(asset, fetchAsset, baseUrl);
      if (asset.mediaType === "image") {
        const bitmap = await decodeImage(blob);
        if (bitmap.width <= 0 || bitmap.height <= 0) {
          bitmap.close();
          throw new Error(`Image asset ${asset.id} decoded with invalid dimensions.`);
        }
        images.set(asset.id, bitmap);
      } else {
        const decoded = await decodeVideo(blob, asset);
        videos.set(asset.id, decoded);
      }
    }

    for (const asset of audioAssets(session)) {
      const blob = await fetchMediaBlob(asset, fetchAsset, baseUrl);
      const buffer = await decodeAudio(blob, asset, session.exportProfile.sampleRate);
      audio.set(asset.id, Object.freeze({ buffer, gain: asset.gain, loop: asset.loop }));
    }
  } catch (error) {
    for (const image of images.values()) image.close();
    for (const video of videos.values()) video.close();
    throw error;
  }

  return Object.freeze({
    images,
    videos,
    audio,
    close(): void {
      for (const image of images.values()) image.close();
      for (const video of videos.values()) video.close();
      images.clear();
      videos.clear();
      audio.clear();
    },
  });
}
