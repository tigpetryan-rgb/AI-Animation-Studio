import { rationalTime } from "@aistudio/core-time";
import { exportAvcOpusMp4 } from "@aistudio/media-export/mp4";
import { drawMovieTimelineFrame } from "./studio-frame-renderer";
import {
  prepareMovieMedia,
  samplePreparedAudio,
  type PreparedMovieMedia,
} from "./studio-media-assets";
import { exportMovieSessionPackage } from "./studio-session-package";
import {
  movieDurationSeconds,
  movieSessionForProjectId,
  rationalSeconds,
  sampleMovieTimeline,
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
  message: "Open a project to export or save its Timeline media.",
};
let syncQueued = false;

function currentProjectId(): string | null {
  const assets = document.querySelector<HTMLElement>(".assets-panel");
  const value = assets?.querySelector<HTMLElement>("p.muted")?.textContent?.trim() ?? "";
  return value.length === 0 || value === "No project open" ? null : value;
}

function currentMovieSession(): StudioMovieSession | null {
  return movieSessionForProjectId(currentProjectId());
}

function setText(node: HTMLElement, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

function safeFileStem(value: string): string {
  const stem = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return stem.length > 0 ? stem : "aistudio-project";
}

function downloadBytes(bytes: Uint8Array, mimeType: string, filename: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
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

function mediaAssetCounts(session: StudioMovieSession): { images: number; videos: number; audio: number } {
  let images = 0;
  let videos = 0;
  let audio = 0;
  for (const asset of Object.values(session.assets)) {
    if (asset.kind === "audio") audio += 1;
    else if (asset.mediaType === "image") images += 1;
    else videos += 1;
  }
  return { images, videos, audio };
}

function timelineSummary(session: StudioMovieSession): string {
  const videoClips = session.timeline.tracks
    .filter((track) => track.kind === "video")
    .reduce((sum, track) => sum + track.clips.length, 0);
  const audioClips = session.timeline.tracks
    .filter((track) => track.kind === "audio")
    .reduce((sum, track) => sum + track.clips.length, 0);
  const counts = mediaAssetCounts(session);
  return `Timeline ${session.timeline.id} · ${movieDurationSeconds(session).toFixed(1)}s · ${videoClips} video clips · ${audioClips} audio clips · ${counts.images} image · ${counts.videos} video file · ${counts.audio} audio files`;
}

async function exportMovieTimeline(session: StudioMovieSession): Promise<void> {
  const projectId = session.project.projectId;
  const { width, height, frameRate, sampleRate, numberOfChannels } = session.exportProfile;
  const durationSeconds = movieDurationSeconds(session);
  const frameCount = Math.ceil(durationSeconds * frameRate);
  const totalAudioFrames = Math.ceil(durationSeconds * sampleRate);
  const counts = mediaAssetCounts(session);
  let preparedMedia: PreparedMovieMedia | undefined;

  updateState({ phase: "RUNNING", progress: 1, message: `Reading ${session.timeline.id}…` });

  try {
    if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas is unavailable in this browser.");

    updateState({
      progress: 3,
      message: `Decoding ${counts.images} image, ${counts.videos} video and ${counts.audio} audio assets…`,
    });
    preparedMedia = await prepareMovieMedia(session);
    updateState({
      progress: 8,
      message: `Decoded ${preparedMedia.images.size} image, ${preparedMedia.videos.size} video and ${preparedMedia.audio.size} audio assets.`,
    });

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
      createFrame: async (index, timestampUs, durationUs) => {
        const timelineTime = rationalTime(BigInt(index), BigInt(frameRate));
        const sample = sampleMovieTimeline(session, timelineTime);
        const timelineSeconds = rationalSeconds(timelineTime);
        await drawMovieTimelineFrame(context, session, media, sample, timelineSeconds, durationSeconds);

        const videoProgress = (index + 1) / frameCount;
        updateState({
          progress: Math.max(state.progress, 8 + Math.round(videoProgress * 62)),
          message: sample.video === undefined
            ? `Encoding Timeline gap… ${index + 1}/${frameCount}`
            : `Rendering ${sample.video.asset.label}… ${index + 1}/${frameCount}`,
        });
        return new VideoFrame(canvas, { timestamp: timestampUs, duration: durationUs });
      },
      createAudioData: (startFrame, frameCountForChunk, timestampUs) => {
        const samples = new Float32Array(frameCountForChunk * numberOfChannels);
        for (let frame = 0; frame < frameCountForChunk; frame += 1) {
          const absoluteFrame = startFrame + frame;
          const timelineTime = rationalTime(BigInt(absoluteFrame), BigInt(sampleRate));
          const timelineSample = sampleMovieTimeline(session, timelineTime);
          const audioSample = timelineSample.audio;
          if (audioSample !== undefined) {
            const decoded = media.audio.get(audioSample.asset.id);
            if (decoded === undefined) throw new Error(`Decoded audio asset ${audioSample.asset.id} is unavailable.`);
            samples[frame] = samplePreparedAudio(decoded, rationalSeconds(audioSample.sourceTime));
          }
        }

        const audioProgress = (startFrame + frameCountForChunk) / totalAudioFrames;
        updateState({
          progress: Math.max(state.progress, 70 + Math.round(audioProgress * 25)),
          message: "Mixing decoded Timeline audio…",
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

    updateState({ progress: 98, message: "Preparing MP4 download…" });
    downloadBytes(exported.bytes, exported.mimeType, `${safeFileStem(projectId)}-timeline.mp4`);
    updateState({
      phase: "SUCCESS",
      progress: 100,
      message: `MP4 ready · ${durationSeconds.toFixed(1)}s · shared Preview/Export renderer · ${media.images.size} decoded image · ${media.videos.size} decoded video · ${media.audio.size} decoded audio · ${exported.encodedVideoChunks} video chunks · ${exported.encodedAudioChunks} audio chunks`,
    });
  } catch (error) {
    updateState({
      phase: "ERROR",
      progress: 0,
      message: error instanceof Error ? error.message : "MP4 Timeline export failed.",
    });
  } finally {
    preparedMedia?.close();
  }
}

async function saveEditableProject(session: StudioMovieSession): Promise<void> {
  if (state.phase === "RUNNING") return;
  updateState({ phase: "RUNNING", progress: 10, message: "Packing Timeline and media manifest into .aistudio…" });
  try {
    const bytes = await exportMovieSessionPackage(session);
    downloadBytes(bytes, "application/zip", `${safeFileStem(session.project.name)}.aistudio`);
    updateState({
      phase: "SUCCESS",
      progress: 100,
      message: `Editable .aistudio saved · ${session.timeline.tracks.length} tracks · ${Object.keys(session.assets).length} media assets`,
    });
  } catch (error) {
    updateState({
      phase: "ERROR",
      progress: 0,
      message: error instanceof Error ? error.message : ".aistudio save failed.",
    });
  }
}

function ensurePanel(assets: HTMLElement): HTMLElement {
  const existing = assets.querySelector<HTMLElement>("[data-studio-export-panel]");
  if (existing !== null) return existing;

  const panel = document.createElement("section");
  panel.dataset.studioExportPanel = "true";
  panel.className = "studio-export-panel";

  const heading = document.createElement("h3");
  heading.textContent = "Export / Save";

  const note = document.createElement("p");
  note.className = "muted";
  note.dataset.exportTimelineSummary = "true";

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "primary";
  exportButton.dataset.exportMp4Button = "true";
  exportButton.addEventListener("click", () => {
    const session = currentMovieSession();
    if (session !== null && state.phase !== "RUNNING") void exportMovieTimeline(session);
  });

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.dataset.saveAistudioButton = "true";
  saveButton.addEventListener("click", () => {
    const session = currentMovieSession();
    if (session !== null && state.phase !== "RUNNING") void saveEditableProject(session);
  });

  const progress = document.createElement("progress");
  progress.max = 100;
  progress.value = 0;
  progress.dataset.exportMp4Progress = "true";

  const status = document.createElement("p");
  status.className = "muted";
  status.dataset.exportMp4Status = "true";
  status.setAttribute("role", "status");

  panel.append(heading, note, exportButton, saveButton, progress, status);
  assets.append(panel);
  return panel;
}

function syncExportPanel(): void {
  syncQueued = false;
  const assets = document.querySelector<HTMLElement>(".assets-panel");
  if (assets === null) return;

  const panel = ensurePanel(assets);
  const exportButton = panel.querySelector<HTMLButtonElement>("[data-export-mp4-button]");
  const saveButton = panel.querySelector<HTMLButtonElement>("[data-save-aistudio-button]");
  const progress = panel.querySelector<HTMLProgressElement>("[data-export-mp4-progress]");
  const status = panel.querySelector<HTMLElement>("[data-export-mp4-status]");
  const summary = panel.querySelector<HTMLElement>("[data-export-timeline-summary]");
  if (exportButton === null || saveButton === null || progress === null || status === null || summary === null) return;

  const session = currentMovieSession();
  const running = state.phase === "RUNNING";
  exportButton.disabled = session === null || running;
  saveButton.disabled = session === null || running;
  setText(exportButton, running ? `Working… ${state.progress}%` : "Export media MP4");
  setText(saveButton, "Save editable .aistudio");
  progress.value = state.progress;
  progress.hidden = state.phase === "IDLE" && session === null;
  status.dataset.exportPhase = state.phase;

  if (session === null) {
    setText(summary, "Open a project to attach its persisted Timeline media session.");
    if (!running) setText(status, "Open a project to export or save its Timeline media.");
    return;
  }

  const counts = mediaAssetCounts(session);
  setText(summary, timelineSummary(session));
  summary.dataset.timelineId = session.timeline.id;
  summary.dataset.timelineDurationSeconds = String(movieDurationSeconds(session));
  summary.dataset.imageAssetCount = String(counts.images);
  summary.dataset.videoAssetCount = String(counts.videos);
  summary.dataset.audioAssetCount = String(counts.audio);
  if (!running && state.phase === "IDLE") {
    setText(status, "Timeline ready: shared Preview/Export renderer, decoded AV media, MP4 export, and editable .aistudio save.");
  } else {
    setText(status, state.message);
  }
}

function scheduleSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(syncExportPanel);
}

window.addEventListener("aistudio:movie-session-change", scheduleSync);

export function installStudioExportPanel(): void {
  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleSync();
}

installStudioExportPanel();
