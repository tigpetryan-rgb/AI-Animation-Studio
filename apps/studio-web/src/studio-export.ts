import { rationalTime } from "@aistudio/core-time";
import { exportAvcOpusMp4 } from "@aistudio/media-export/mp4";
import { prepareMovieMedia, type PreparedMovieMedia } from "./studio-media-assets";
import {
  movieDurationSeconds,
  movieSessionForProjectId,
  rationalSeconds,
  sampleMovieTimeline,
  type MovieTimelineSample,
  type StudioMovieSession,
} from "./studio-movie-session";

const EXPORT_AUDIO_CHUNK_FRAMES = 960;

interface ExportPanelState {
  phase: "IDLE" | "RUNNING" | "SUCCESS" | "ERROR";
  progress: number;
  message: string;
}

let state: ExportPanelState = {
  phase: "IDLE",
  progress: 0,
  message: "Open the local demo project to export its timeline media.",
};
let syncQueued = false;

function currentProjectId(): string | null {
  const assets = document.querySelector<HTMLElement>(".assets-panel");
  if (assets === null) return null;
  const value = assets.querySelector<HTMLElement>("p.muted")?.textContent?.trim() ?? "";
  if (value.length === 0 || value === "No project open") return null;
  return value;
}

function currentMovieSession(): StudioMovieSession | null {
  return movieSessionForProjectId(currentProjectId());
}

function setText(node: HTMLElement, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

function safeFileStem(projectId: string): string {
  const stem = projectId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return stem.length > 0 ? stem : "aistudio-project";
}

function downloadMp4(bytes: Uint8Array, mimeType: string, projectId: string): void {
  const blobBytes = new Uint8Array(bytes.byteLength);
  blobBytes.set(bytes);
  const blob = new Blob([blobBytes.buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileStem(projectId)}-timeline.mp4`;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function updateState(next: Partial<ExportPanelState>): void {
  state = { ...state, ...next };
  syncExportPanel();
}

function normalizedLoop(seconds: number, periodSeconds: number): number {
  if (periodSeconds <= 0) return 0;
  const remainder = seconds % periodSeconds;
  return (remainder < 0 ? remainder + periodSeconds : remainder) / periodSeconds;
}

function drawDecodedImage(
  context: OffscreenCanvasRenderingContext2D,
  image: ImageBitmap,
  width: number,
  height: number,
  sourceSeconds: number,
  pan: "left-to-right" | "right-to-left",
): void {
  const targetAspect = width / height;
  const sourceAspect = image.width / image.height;
  let baseCropWidth: number;
  let baseCropHeight: number;

  if (sourceAspect >= targetAspect) {
    baseCropHeight = image.height;
    baseCropWidth = baseCropHeight * targetAspect;
  } else {
    baseCropWidth = image.width;
    baseCropHeight = baseCropWidth / targetAspect;
  }

  const zoom = 1.08;
  const cropWidth = baseCropWidth / zoom;
  const cropHeight = baseCropHeight / zoom;
  const maxX = Math.max(0, image.width - cropWidth);
  const maxY = Math.max(0, image.height - cropHeight);
  const phase = normalizedLoop(sourceSeconds, 2);
  const sx = pan === "left-to-right" ? maxX * phase : maxX * (1 - phase);
  const sy = maxY / 2;

  context.drawImage(
    image,
    sx,
    sy,
    cropWidth,
    cropHeight,
    0,
    0,
    width,
    height,
  );
}

function drawTimelineFrame(
  context: OffscreenCanvasRenderingContext2D,
  session: StudioMovieSession,
  media: PreparedMovieMedia,
  sample: MovieTimelineSample,
  timelineSeconds: number,
  durationSeconds: number,
): void {
  const { width, height } = session.exportProfile;
  const video = sample.video;
  if (video === undefined) {
    context.fillStyle = "rgb(8, 10, 14)";
    context.fillRect(0, 0, width, height);
    return;
  }

  const image = media.images.get(video.asset.id);
  if (image === undefined) throw new Error(`Decoded image asset ${video.asset.id} is unavailable.`);

  const sourceSeconds = rationalSeconds(video.sourceTime);
  drawDecodedImage(context, image, width, height, sourceSeconds, video.asset.pan);

  context.fillStyle = "rgba(5, 8, 14, 0.68)";
  context.fillRect(12, 12, 178, 60);
  context.fillStyle = "rgb(248, 250, 252)";
  context.font = "bold 14px sans-serif";
  context.fillText(video.asset.label, 20, 32);
  context.font = "11px sans-serif";
  context.fillText(`clip ${video.clip.id}`, 20, 49);
  context.fillText(`decoded image · source ${sourceSeconds.toFixed(2)}s`, 20, 64);

  const progress = durationSeconds <= 0 ? 0 : Math.min(1, timelineSeconds / durationSeconds);
  context.fillStyle = "rgba(255,255,255,0.24)";
  context.fillRect(20, height - 22, width - 40, 5);
  context.fillStyle = "rgba(255,255,255,0.92)";
  context.fillRect(20, height - 22, Math.round((width - 40) * progress), 5);
  context.font = "11px monospace";
  context.fillText(`${timelineSeconds.toFixed(2)} / ${durationSeconds.toFixed(2)}s`, 20, height - 32);
}

function mediaAssetCount(session: StudioMovieSession): number {
  return Object.values(session.assets).filter((asset) => asset.kind === "video" && asset.mediaType === "image").length;
}

function timelineSummary(session: StudioMovieSession): string {
  const videoClips = session.timeline.tracks
    .filter((track) => track.kind === "video")
    .reduce((sum, track) => sum + track.clips.length, 0);
  const audioClips = session.timeline.tracks
    .filter((track) => track.kind === "audio")
    .reduce((sum, track) => sum + track.clips.length, 0);
  return `Timeline ${session.timeline.id} · ${movieDurationSeconds(session).toFixed(1)}s · ${videoClips} video clips · ${audioClips} audio clips · ${mediaAssetCount(session)} image assets`;
}

async function exportMovieTimeline(session: StudioMovieSession): Promise<void> {
  const projectId = session.project.projectId;
  const { width, height, frameRate, sampleRate, numberOfChannels } = session.exportProfile;
  const durationSeconds = movieDurationSeconds(session);
  const frameCount = Math.ceil(durationSeconds * frameRate);
  const totalAudioFrames = Math.ceil(durationSeconds * sampleRate);
  let preparedMedia: PreparedMovieMedia | undefined;

  updateState({
    phase: "RUNNING",
    progress: 1,
    message: `Reading ${session.timeline.id}…`,
  });

  try {
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("OffscreenCanvas is unavailable in this browser.");
    }

    updateState({ progress: 3, message: `Decoding ${mediaAssetCount(session)} image assets…` });
    preparedMedia = await prepareMovieMedia(session);
    updateState({ progress: 6, message: `Decoded ${preparedMedia.images.size} image assets. Preparing encoder…` });

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("2D canvas context is unavailable.");

    const media = preparedMedia;
    const exported = await exportAvcOpusMp4({
      width,
      height,
      frameRate,
      frameCount,
      videoBitrate: 500_000,
      numberOfChannels,
      totalAudioFrames,
      audioChunkFrames: EXPORT_AUDIO_CHUNK_FRAMES,
      audioBitrate: 64_000,
      createFrame: (index, timestampUs, durationUs) => {
        const timelineTime = rationalTime(BigInt(index), BigInt(frameRate));
        const sample = sampleMovieTimeline(session, timelineTime);
        const timelineSeconds = rationalSeconds(timelineTime);
        drawTimelineFrame(context, session, media, sample, timelineSeconds, durationSeconds);

        const videoProgress = (index + 1) / frameCount;
        updateState({
          progress: Math.max(state.progress, 6 + Math.round(videoProgress * 64)),
          message: sample.video === undefined
            ? `Encoding timeline gap… ${index + 1}/${frameCount}`
            : `Compositing ${sample.video.asset.label}… ${index + 1}/${frameCount}`,
        });
        return new VideoFrame(canvas, { timestamp: timestampUs, duration: durationUs });
      },
      createAudioData: (startFrame, frameCountForChunk, timestampUs) => {
        const samples = new Float32Array(frameCountForChunk * numberOfChannels);
        for (let frame = 0; frame < frameCountForChunk; frame += 1) {
          const absoluteFrame = startFrame + frame;
          const timelineTime = rationalTime(BigInt(absoluteFrame), BigInt(sampleRate));
          const timelineSample = sampleMovieTimeline(session, timelineTime);
          const audio = timelineSample.audio;
          if (audio !== undefined) {
            const sourceSeconds = rationalSeconds(audio.sourceTime);
            samples[frame] = Math.sin(2 * Math.PI * audio.asset.frequencyHz * sourceSeconds) * audio.asset.gain;
          }
        }

        const audioProgress = (startFrame + frameCountForChunk) / totalAudioFrames;
        updateState({
          progress: Math.max(state.progress, 70 + Math.round(audioProgress * 25)),
          message: "Encoding timeline audio…",
        });
        return new AudioData({
          format: "f32",
          sampleRate,
          numberOfFrames: frameCountForChunk,
          numberOfChannels,
          timestamp: timestampUs,
          data: samples,
        });
      },
    });

    updateState({ progress: 98, message: "Preparing timeline download…" });
    downloadMp4(exported.bytes, exported.mimeType, projectId);
    updateState({
      phase: "SUCCESS",
      progress: 100,
      message: `MP4 ready from ${session.timeline.id} · ${durationSeconds.toFixed(1)}s · ${media.images.size} decoded images · ${exported.encodedVideoChunks} video chunks · ${exported.encodedAudioChunks} audio chunks`,
    });
  } catch (error) {
    updateState({
      phase: "ERROR",
      progress: 0,
      message: error instanceof Error ? error.message : "MP4 timeline export failed.",
    });
  } finally {
    preparedMedia?.close();
  }
}

function ensurePanel(assets: HTMLElement): HTMLElement {
  const existing = assets.querySelector<HTMLElement>("[data-studio-export-panel]");
  if (existing !== null) return existing;

  const panel = document.createElement("section");
  panel.dataset.studioExportPanel = "true";
  panel.className = "studio-export-panel";

  const heading = document.createElement("h3");
  heading.textContent = "Export";

  const note = document.createElement("p");
  note.className = "muted";
  note.dataset.exportTimelineSummary = "true";
  note.textContent = "M35: Timeline video clips decode real image media before MP4 composition.";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary";
  button.dataset.exportMp4Button = "true";
  button.addEventListener("click", () => {
    const session = currentMovieSession();
    if (session !== null && state.phase !== "RUNNING") {
      void exportMovieTimeline(session);
    }
  });

  const progress = document.createElement("progress");
  progress.max = 100;
  progress.value = 0;
  progress.dataset.exportMp4Progress = "true";

  const status = document.createElement("p");
  status.className = "muted";
  status.dataset.exportMp4Status = "true";
  status.setAttribute("role", "status");

  panel.append(heading, note, button, progress, status);
  assets.append(panel);
  return panel;
}

function syncExportPanel(): void {
  syncQueued = false;
  const assets = document.querySelector<HTMLElement>(".assets-panel");
  if (assets === null) return;

  const panel = ensurePanel(assets);
  const button = panel.querySelector<HTMLButtonElement>("[data-export-mp4-button]");
  const progress = panel.querySelector<HTMLProgressElement>("[data-export-mp4-progress]");
  const status = panel.querySelector<HTMLElement>("[data-export-mp4-status]");
  const summary = panel.querySelector<HTMLElement>("[data-export-timeline-summary]");
  if (button === null || progress === null || status === null || summary === null) return;

  const session = currentMovieSession();
  const running = state.phase === "RUNNING";
  button.disabled = session === null || running;
  setText(button, running ? `Exporting… ${state.progress}%` : "Export media MP4");
  progress.value = state.progress;
  progress.hidden = state.phase === "IDLE" && session === null;
  status.dataset.exportPhase = state.phase;

  if (session === null) {
    setText(summary, "M35: open the local demo project to attach its Timeline media session.");
    if (!running) setText(status, "Open the local demo project to export its timeline media.");
  } else {
    setText(summary, timelineSummary(session));
    summary.dataset.timelineId = session.timeline.id;
    summary.dataset.timelineDurationSeconds = String(movieDurationSeconds(session));
    summary.dataset.imageAssetCount = String(mediaAssetCount(session));
    if (!running && state.phase === "IDLE") {
      setText(status, "Timeline media ready for image decode + H.264/Opus MP4 export.");
    } else {
      setText(status, state.message);
    }
  }
}

function scheduleSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(syncExportPanel);
}

export function installStudioExportPanel(): void {
  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleSync();
}

installStudioExportPanel();
