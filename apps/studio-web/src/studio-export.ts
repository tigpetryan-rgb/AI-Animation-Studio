import { rationalTime } from "@aistudio/core-time";
import {
  exportAvcOpusFragmentedMp4,
  exportAvcOpusMp4,
} from "@aistudio/media-export/mp4";
import {
  isStudioExportSelectionSupported,
  probeStudioExportCapabilities,
  studioCapabilityKey,
  studioCompatibilitySummary,
  type StudioExportCapabilityMatrix,
} from "./studio-export-capabilities";
import { drawMovieTimelineFrame } from "./studio-frame-renderer";
import {
  prepareMovieMedia,
  samplePreparedAudio,
  type PreparedMovieMedia,
} from "./studio-media-assets";
import {
  DEFAULT_STUDIO_EXPORT_SETTINGS,
  exportPlanSummary,
  planStudioExport,
  type ExportAudioBitratePreset,
  type ExportFrameRatePreset,
  type ExportQualityPreset,
  type ExportResolutionPreset,
  type ExportStorageMode,
  type StudioExportPlan,
  type StudioExportSettings,
} from "./studio-export-plan";
import {
  canUseDiskStreamedExport,
  createStudioStreamingExportFile,
  type StudioStreamingExportFile,
} from "./studio-export-storage";
import { exportMovieSessionPackage } from "./studio-session-package";
import {
  movieDurationSeconds,
  movieSessionForProjectId,
  rationalSeconds,
  sampleMovieTimeline,
  type StudioMovieSession,
} from "./studio-movie-session";

const EXPORT_AUDIO_CHUNK_FRAMES = 960;
const RESOLUTION_PRESETS: readonly ExportResolutionPreset[] = ["source", "720p", "1080p"];
const FRAME_RATE_PRESETS: readonly ExportFrameRatePreset[] = ["source", "24", "30"];

type ExportPanelPhase = "IDLE" | "RUNNING" | "SUCCESS" | "ERROR" | "CANCELLED";
type ExportPanelOperation = "NONE" | "EXPORT" | "SAVE";

interface ExportPanelState {
  readonly phase: ExportPanelPhase;
  readonly operation: ExportPanelOperation;
  readonly progress: number;
  readonly message: string;
}

let state: ExportPanelState = {
  phase: "IDLE",
  operation: "NONE",
  progress: 0,
  message: "Open the local demo project to export or save its timeline media.",
};
let settings: StudioExportSettings = { ...DEFAULT_STUDIO_EXPORT_SETTINGS };
let activeExportController: AbortController | null = null;
let capabilityMatrix: StudioExportCapabilityMatrix | null = null;
let capabilitySignature = "";
let capabilityProbeSequence = 0;
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

function currentStorageMode(): ExportStorageMode {
  return canUseDiskStreamedExport() ? "streaming" : "memory";
}

function currentPlan(session: StudioMovieSession): StudioExportPlan {
  return planStudioExport(
    session.exportProfile,
    movieDurationSeconds(session),
    settings,
    currentStorageMode(),
  );
}

function exportSessionForPlan(session: StudioMovieSession, plan: StudioExportPlan): StudioMovieSession {
  return Object.freeze({
    ...session,
    exportProfile: Object.freeze({
      ...session.exportProfile,
      width: plan.width,
      height: plan.height,
      frameRate: plan.frameRate,
    }),
  });
}

function capabilityProbeSignature(session: StudioMovieSession): string {
  return [
    session.project.projectId,
    movieDurationSeconds(session),
    session.exportProfile.width,
    session.exportProfile.height,
    session.exportProfile.frameRate,
    session.exportProfile.sampleRate,
    settings.quality,
    settings.audioBitrate,
  ].join(":");
}

function invalidateCapabilities(): void {
  capabilitySignature = "";
  capabilityMatrix = null;
}

function ensureCapabilityProbe(session: StudioMovieSession): void {
  const signature = capabilityProbeSignature(session);
  if (signature === capabilitySignature) return;
  capabilitySignature = signature;
  capabilityMatrix = null;
  const sequence = ++capabilityProbeSequence;
  void probeStudioExportCapabilities(
    session.exportProfile,
    movieDurationSeconds(session),
    settings,
  ).then((matrix) => {
    if (sequence !== capabilityProbeSequence || capabilitySignature !== signature) return;
    capabilityMatrix = matrix;
    scheduleSync();
  }).catch(() => {
    if (sequence !== capabilityProbeSequence || capabilitySignature !== signature) return;
    capabilityMatrix = null;
    scheduleSync();
  });
}

function resolutionAvailable(matrix: StudioExportCapabilityMatrix, resolution: ExportResolutionPreset): boolean {
  return FRAME_RATE_PRESETS.some((frameRate) => matrix.video[studioCapabilityKey(resolution, frameRate)] === true);
}

function frameRateAvailable(matrix: StudioExportCapabilityMatrix, frameRate: ExportFrameRatePreset): boolean {
  return RESOLUTION_PRESETS.some((resolution) => matrix.video[studioCapabilityKey(resolution, frameRate)] === true);
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Export cancelled by user.");
}

async function yieldToBrowser(signal: AbortSignal): Promise<void> {
  throwIfCancelled(signal);
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  throwIfCancelled(signal);
}

function requestCancel(): void {
  const controller = activeExportController;
  if (controller === null || controller.signal.aborted) return;
  controller.abort();
  updateState({ message: "Cancelling export…" });
}

async function exportMovieTimeline(session: StudioMovieSession): Promise<void> {
  const plan = currentPlan(session);
  if (plan.blockedReason !== null) {
    updateState({ phase: "ERROR", operation: "NONE", progress: 0, message: plan.blockedReason });
    return;
  }
  if (session.exportProfile.sampleRate !== 48_000) {
    updateState({
      phase: "ERROR",
      operation: "NONE",
      progress: 0,
      message: "Current native MP4 audio path requires a 48 kHz project sample rate.",
    });
    return;
  }

  const matrix = capabilityMatrix ?? await probeStudioExportCapabilities(
    session.exportProfile,
    movieDurationSeconds(session),
    settings,
  );
  capabilityMatrix = matrix;
  if (!isStudioExportSelectionSupported(matrix, settings)) {
    updateState({
      phase: "ERROR",
      operation: "NONE",
      progress: 0,
      message: "This device cannot encode the selected H.264 / Opus export profile. Choose an enabled resolution/frame-rate preset.",
    });
    return;
  }

  const projectId = session.project.projectId;
  const exportSession = exportSessionForPlan(session, plan);
  const { width, height, frameRate, sampleRate, numberOfChannels } = exportSession.exportProfile;
  const durationSeconds = movieDurationSeconds(exportSession);
  const counts = mediaAssetCounts(exportSession);
  const controller = new AbortController();
  const signal = controller.signal;
  activeExportController = controller;
  let preparedMedia: PreparedMovieMedia | undefined;
  let streamingFile: StudioStreamingExportFile | undefined;
  let streamingFinalized = false;

  updateState({
    phase: "RUNNING",
    operation: "EXPORT",
    progress: 1,
    message: `Preflight passed · ${exportPlanSummary(plan)}`,
  });

  try {
    await yieldToBrowser(signal);
    if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas is unavailable in this browser.");
    throwIfCancelled(signal);

    updateState({
      progress: 3,
      message: `Decoding ${counts.images} image, ${counts.videos} video and ${counts.audio} audio assets…`,
    });
    preparedMedia = await prepareMovieMedia(exportSession);
    throwIfCancelled(signal);
    updateState({
      progress: 8,
      message: `Decoded media · starting ${width}×${height} @ ${frameRate} fps encode…`,
    });

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("2D canvas context is unavailable.");

    const media = preparedMedia;
    const yieldEveryVideoFrames = Math.max(1, Math.round(frameRate / 4));
    const yieldEveryAudioChunks = 10;
    const createFrame = async (index: number, timestampUs: number, durationUs: number): Promise<VideoFrame> => {
      if (index % yieldEveryVideoFrames === 0) await yieldToBrowser(signal);
      else throwIfCancelled(signal);

      const timelineTime = rationalTime(BigInt(index), BigInt(frameRate));
      const sample = sampleMovieTimeline(exportSession, timelineTime);
      const timelineSeconds = rationalSeconds(timelineTime);
      await drawMovieTimelineFrame(context, exportSession, media, sample, timelineSeconds, durationSeconds);
      throwIfCancelled(signal);

      const videoProgress = (index + 1) / plan.frameCount;
      updateState({
        progress: Math.max(state.progress, 8 + Math.round(videoProgress * 62)),
        message: sample.video === undefined
          ? `Encoding timeline gap… ${index + 1}/${plan.frameCount}`
          : `Compositing ${sample.video.asset.label}… ${index + 1}/${plan.frameCount}`,
      });
      return new VideoFrame(canvas, { timestamp: timestampUs, duration: durationUs });
    };

    const createAudioData = async (
      startFrame: number,
      frameCountForChunk: number,
      timestampUs: number,
    ): Promise<AudioData> => {
      const chunkIndex = Math.floor(startFrame / EXPORT_AUDIO_CHUNK_FRAMES);
      if (chunkIndex % yieldEveryAudioChunks === 0) await yieldToBrowser(signal);
      else throwIfCancelled(signal);

      const samples = new Float32Array(frameCountForChunk * numberOfChannels);
      for (let frame = 0; frame < frameCountForChunk; frame += 1) {
        const absoluteFrame = startFrame + frame;
        const timelineTime = rationalTime(BigInt(absoluteFrame), BigInt(sampleRate));
        const timelineSample = sampleMovieTimeline(exportSession, timelineTime);
        const audioSample = timelineSample.audio;
        if (audioSample !== undefined) {
          const decoded = media.audio.get(audioSample.asset.id);
          if (decoded === undefined) throw new Error(`Decoded audio asset ${audioSample.asset.id} is unavailable.`);
          samples[frame] = samplePreparedAudio(decoded, rationalSeconds(audioSample.sourceTime));
        }
      }
      throwIfCancelled(signal);

      const audioProgress = (startFrame + frameCountForChunk) / plan.totalAudioFrames;
      updateState({
        progress: Math.max(state.progress, 70 + Math.round(audioProgress * 25)),
        message: "Mixing decoded timeline audio…",
      });
      return new AudioData({
        format: "f32",
        sampleRate,
        numberOfFrames: frameCountForChunk,
        numberOfChannels,
        timestamp: timestampUs,
        data: samples,
      });
    };

    const filename = `${safeFileStem(projectId)}-timeline.mp4`;
    if (plan.storageMode === "streaming") {
      updateState({
        progress: 8,
        message: `Opening disk-backed streaming export · ${exportPlanSummary(plan)}`,
      });
      streamingFile = await createStudioStreamingExportFile(safeFileStem(projectId));
      const exported = await exportAvcOpusFragmentedMp4({
        width,
        height,
        frameRate,
        frameCount: plan.frameCount,
        videoBitrate: plan.videoBitrate,
        numberOfChannels,
        totalAudioFrames: plan.totalAudioFrames,
        audioChunkFrames: EXPORT_AUDIO_CHUNK_FRAMES,
        audioBitrate: plan.audioBitrate,
        fragmentDurationSeconds: 1,
        createFrame,
        createAudioData,
        sink: streamingFile.sink,
        signal,
      });

      throwIfCancelled(signal);
      updateState({ progress: 98, message: "Finalizing disk-streamed MP4 download…" });
      const file = await streamingFile.finalize(exported.mimeType, filename);
      streamingFinalized = true;
      updateState({
        phase: "SUCCESS",
        operation: "NONE",
        progress: 100,
        message: `MP4 ready · ${width}×${height} @ ${frameRate} fps · disk-streamed ${Math.round(file.size / 1024)} KiB · ${exported.fragmentsWritten} fragments · shared Preview/Export renderer · ${media.images.size} decoded image · ${media.videos.size} decoded video · ${media.audio.size} decoded audio · ${exported.encodedVideoChunks} video chunks · ${exported.encodedAudioChunks} audio chunks`,
      });
    } else {
      const exported = await exportAvcOpusMp4({
        width,
        height,
        frameRate,
        frameCount: plan.frameCount,
        videoBitrate: plan.videoBitrate,
        numberOfChannels,
        totalAudioFrames: plan.totalAudioFrames,
        audioChunkFrames: EXPORT_AUDIO_CHUNK_FRAMES,
        audioBitrate: plan.audioBitrate,
        createFrame,
        createAudioData,
      });

      throwIfCancelled(signal);
      updateState({ progress: 98, message: "Preparing in-memory MP4 download…" });
      downloadBytes(exported.bytes, exported.mimeType, filename);
      updateState({
        phase: "SUCCESS",
        operation: "NONE",
        progress: 100,
        message: `MP4 ready · ${width}×${height} @ ${frameRate} fps · in-memory fallback · shared Preview/Export renderer · ${media.images.size} decoded image · ${media.videos.size} decoded video · ${media.audio.size} decoded audio · ${exported.encodedVideoChunks} video chunks · ${exported.encodedAudioChunks} audio chunks`,
      });
    }
  } catch (error) {
    if (streamingFile !== undefined && !streamingFinalized) await streamingFile.abort(error);
    if (signal.aborted) {
      updateState({
        phase: "CANCELLED",
        operation: "NONE",
        progress: 0,
        message: "Export cancelled. No MP4 was downloaded.",
      });
    } else {
      updateState({
        phase: "ERROR",
        operation: "NONE",
        progress: 0,
        message: error instanceof Error ? error.message : "MP4 timeline export failed.",
      });
    }
  } finally {
    preparedMedia?.close();
    if (activeExportController === controller) activeExportController = null;
    syncExportPanel();
  }
}

async function saveEditableProject(session: StudioMovieSession): Promise<void> {
  if (state.phase === "RUNNING") return;
  updateState({
    phase: "RUNNING",
    operation: "SAVE",
    progress: 10,
    message: "Packing Timeline and media manifest into .aistudio…",
  });
  try {
    const bytes = await exportMovieSessionPackage(session);
    downloadBytes(bytes, "application/zip", `${safeFileStem(session.project.name)}.aistudio`);
    updateState({
      phase: "SUCCESS",
      operation: "NONE",
      progress: 100,
      message: `Editable .aistudio saved · ${session.timeline.tracks.length} tracks · ${Object.keys(session.assets).length} media assets`,
    });
  } catch (error) {
    updateState({
      phase: "ERROR",
      operation: "NONE",
      progress: 0,
      message: error instanceof Error ? error.message : ".aistudio save failed.",
    });
  }
}

function appendOption(select: HTMLSelectElement, value: string, label: string): void {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function createSettingSelect(labelText: string, datasetKey: string): { wrapper: HTMLLabelElement; select: HTMLSelectElement } {
  const wrapper = document.createElement("label");
  wrapper.className = "export-setting";
  const label = document.createElement("span");
  label.textContent = labelText;
  const select = document.createElement("select");
  select.dataset[datasetKey] = "true";
  wrapper.append(label, select);
  return { wrapper, select };
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

  const settingsGrid = document.createElement("div");
  settingsGrid.className = "export-settings-grid";

  const resolution = createSettingSelect("Resolution", "exportResolutionSelect");
  appendOption(resolution.select, "source", "Source");
  appendOption(resolution.select, "720p", "HD 720p");
  appendOption(resolution.select, "1080p", "Full HD 1080p");
  resolution.select.addEventListener("change", () => {
    settings = { ...settings, resolution: resolution.select.value as ExportResolutionPreset };
    syncExportPanel();
  });

  const frameRate = createSettingSelect("Frame rate", "exportFrameRateSelect");
  appendOption(frameRate.select, "source", "Source");
  appendOption(frameRate.select, "24", "24 fps");
  appendOption(frameRate.select, "30", "30 fps");
  frameRate.select.addEventListener("change", () => {
    settings = { ...settings, frameRate: frameRate.select.value as ExportFrameRatePreset };
    syncExportPanel();
  });

  const quality = createSettingSelect("Video quality", "exportQualitySelect");
  appendOption(quality.select, "draft", "Draft");
  appendOption(quality.select, "balanced", "Balanced");
  appendOption(quality.select, "high", "High");
  quality.select.addEventListener("change", () => {
    settings = { ...settings, quality: quality.select.value as ExportQualityPreset };
    invalidateCapabilities();
    syncExportPanel();
  });

  const audio = createSettingSelect("Audio bitrate", "exportAudioBitrateSelect");
  appendOption(audio.select, "64", "64 kbps");
  appendOption(audio.select, "96", "96 kbps");
  appendOption(audio.select, "128", "128 kbps");
  audio.select.addEventListener("change", () => {
    settings = { ...settings, audioBitrate: audio.select.value as ExportAudioBitratePreset };
    invalidateCapabilities();
    syncExportPanel();
  });
  settingsGrid.append(resolution.wrapper, frameRate.wrapper, quality.wrapper, audio.wrapper);

  const planSummary = document.createElement("p");
  planSummary.className = "export-plan-summary muted";
  planSummary.dataset.exportPlanSummary = "true";

  const capabilitySummary = document.createElement("p");
  capabilitySummary.className = "export-capability-summary muted";
  capabilitySummary.dataset.exportCapabilitySummary = "true";

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "primary";
  exportButton.dataset.exportMp4Button = "true";
  exportButton.addEventListener("click", () => {
    const session = currentMovieSession();
    if (session !== null && state.phase !== "RUNNING") void exportMovieTimeline(session);
  });

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.dataset.cancelExportButton = "true";
  cancelButton.textContent = "Cancel export";
  cancelButton.addEventListener("click", requestCancel);

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

  panel.append(
    heading,
    note,
    settingsGrid,
    planSummary,
    capabilitySummary,
    exportButton,
    cancelButton,
    saveButton,
    progress,
    status,
  );
  assets.append(panel);
  return panel;
}

function syncExportPanel(): void {
  syncQueued = false;
  const assets = document.querySelector<HTMLElement>(".assets-panel");
  if (assets === null) return;

  const panel = ensurePanel(assets);
  const exportButton = panel.querySelector<HTMLButtonElement>("[data-export-mp4-button]");
  const cancelButton = panel.querySelector<HTMLButtonElement>("[data-cancel-export-button]");
  const saveButton = panel.querySelector<HTMLButtonElement>("[data-save-aistudio-button]");
  const progress = panel.querySelector<HTMLProgressElement>("[data-export-mp4-progress]");
  const status = panel.querySelector<HTMLElement>("[data-export-mp4-status]");
  const summary = panel.querySelector<HTMLElement>("[data-export-timeline-summary]");
  const planSummary = panel.querySelector<HTMLElement>("[data-export-plan-summary]");
  const compatibility = panel.querySelector<HTMLElement>("[data-export-capability-summary]");
  const resolution = panel.querySelector<HTMLSelectElement>("[data-export-resolution-select]");
  const frameRate = panel.querySelector<HTMLSelectElement>("[data-export-frame-rate-select]");
  const quality = panel.querySelector<HTMLSelectElement>("[data-export-quality-select]");
  const audio = panel.querySelector<HTMLSelectElement>("[data-export-audio-bitrate-select]");
  if (
    exportButton === null || cancelButton === null || saveButton === null || progress === null
    || status === null || summary === null || planSummary === null || compatibility === null
    || resolution === null || frameRate === null || quality === null || audio === null
  ) return;

  const session = currentMovieSession();
  const running = state.phase === "RUNNING";
  const exporting = running && state.operation === "EXPORT";
  let plan: StudioExportPlan | null = null;
  if (session !== null) {
    plan = currentPlan(session);
    ensureCapabilityProbe(session);
  }

  resolution.value = settings.resolution;
  frameRate.value = settings.frameRate;
  quality.value = settings.quality;
  audio.value = settings.audioBitrate;
  for (const control of [resolution, frameRate, quality, audio]) control.disabled = running || session === null;

  if (capabilityMatrix !== null && session !== null && !running) {
    for (const option of Array.from(resolution.options)) {
      const preset = option.value as ExportResolutionPreset;
      option.disabled = !resolutionAvailable(capabilityMatrix, preset);
      option.dataset.codecSupported = String(!option.disabled);
    }
    for (const option of Array.from(frameRate.options)) {
      const preset = option.value as ExportFrameRatePreset;
      option.disabled = !frameRateAvailable(capabilityMatrix, preset);
      option.dataset.codecSupported = String(!option.disabled);
    }
  }

  const selectedCapabilitySupported = capabilityMatrix !== null
    && isStudioExportSelectionSupported(capabilityMatrix, settings);
  exportButton.disabled = session === null
    || running
    || plan?.blockedReason !== null
    || capabilityMatrix === null
    || !selectedCapabilitySupported;
  saveButton.disabled = session === null || running;
  cancelButton.hidden = !exporting;
  cancelButton.disabled = !exporting || activeExportController?.signal.aborted === true;
  setText(exportButton, exporting ? `Exporting… ${state.progress}%` : "Export MP4");
  setText(saveButton, state.operation === "SAVE" ? "Saving…" : "Save editable .aistudio");
  progress.value = state.progress;
  progress.hidden = state.phase === "IDLE" && session === null;
  status.dataset.exportPhase = state.phase;
  status.dataset.exportOperation = state.operation;

  if (session === null) {
    capabilityMatrix = null;
    capabilitySignature = "";
    setText(summary, "Open the local demo project to attach its persisted Timeline media session.");
    setText(planSummary, "Export settings become available when a project is open.");
    setText(compatibility, "Device codec capabilities will be checked after a project opens.");
    if (!running) setText(status, "Open the local demo project to export or save its timeline media.");
    return;
  }

  const counts = mediaAssetCounts(session);
  setText(summary, timelineSummary(session));
  summary.dataset.timelineId = session.timeline.id;
  summary.dataset.timelineDurationSeconds = String(movieDurationSeconds(session));
  summary.dataset.imageAssetCount = String(counts.images);
  summary.dataset.videoAssetCount = String(counts.videos);
  summary.dataset.audioAssetCount = String(counts.audio);

  if (plan !== null) {
    setText(planSummary, plan.blockedReason ?? plan.warning ?? exportPlanSummary(plan));
    planSummary.dataset.exportWidth = String(plan.width);
    planSummary.dataset.exportHeight = String(plan.height);
    planSummary.dataset.exportFrameRate = String(plan.frameRate);
    planSummary.dataset.exportVideoBitrate = String(plan.videoBitrate);
    planSummary.dataset.exportAudioBitrate = String(plan.audioBitrate);
    planSummary.dataset.exportEstimatedBytes = String(plan.estimatedOutputBytes);
    planSummary.dataset.exportPeakBytes = String(plan.estimatedPeakWorkingBytes);
    planSummary.dataset.exportStorageMode = plan.storageMode;
    planSummary.dataset.exportBlocked = String(plan.blockedReason !== null);
  }

  if (capabilityMatrix === null) {
    setText(compatibility, "Checking this device's H.264 / Opus / AAC encoder capabilities…");
    compatibility.dataset.exportSelectedSupported = "pending";
  } else {
    setText(compatibility, studioCompatibilitySummary(capabilityMatrix));
    compatibility.dataset.exportOpusSupported = String(capabilityMatrix.opusSupported);
    compatibility.dataset.exportAacSupported = String(capabilityMatrix.aacSupported);
    compatibility.dataset.exportSelectedSupported = String(selectedCapabilitySupported);
  }

  if (running || state.phase !== "IDLE") {
    setText(status, state.message);
  } else if (capabilityMatrix === null) {
    setText(status, "Timeline ready · checking this device's export capabilities…");
  } else if (!selectedCapabilitySupported) {
    setText(status, "The selected export profile is unavailable on this device. Choose an enabled resolution/frame-rate combination.");
  } else {
    const storage = plan?.storageMode === "streaming" ? "disk-streamed" : "in-memory fallback";
    setText(status, `Timeline ready: ${storage} MP4 export is available, or save editable .aistudio.`);
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
  window.addEventListener("aistudio:movie-session-change", () => {
    invalidateCapabilities();
    scheduleSync();
  });
  scheduleSync();
}

installStudioExportPanel();
