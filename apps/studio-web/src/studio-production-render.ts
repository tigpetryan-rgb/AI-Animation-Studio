import { exportAvcOpusFragmentedMp4 } from "@aistudio/media-export/mp4";
import { currentStudioBuildIdentity } from "./device-check";
import { cameraExecutionForChat } from "./studio-production-camera";
import { productionJobForChat } from "./studio-production-intake-v2";
import {
  prepareProductionRenderer,
  verifyProductionTemporalMotion,
  type PreparedProductionRenderer,
  type ProductionRenderArtifact,
} from "./studio-production-renderer";
import {
  createStudioStreamingExportFile,
  type StudioStreamingExportFinalization,
  type StudioStreamingExportFile,
} from "./studio-export-storage";

const RENDER_STORAGE_KEY = "aistudio.runtime.production-render.v1";
const OPUS_SAMPLE_RATE = 48_000;
const OPUS_CHUNK_FRAMES = 960;
const AUDIO_BITRATE = 96_000;

type RenderStatus = "RENDER_READY" | "EXPORTING" | "MP4_READY" | "BLOCKED";

interface ChatSubmitDetail {
  readonly chatId?: unknown;
  readonly files?: unknown;
}

interface ProductionMp4Record {
  readonly mimeType: string;
  readonly videoCodec: string;
  readonly audioCodec: string;
  readonly bytesWritten: number;
  readonly encodedVideoChunks: number;
  readonly encodedAudioChunks: number;
  readonly fragmentsWritten: number;
  readonly nativeSha256: string | null;
  readonly nativeUri: string | null;
  readonly nativeVerified: boolean | null;
  readonly nativeInspectionNote: string | null;
}

interface PersistedProductionRender {
  readonly chatId: string;
  readonly projectId: string;
  readonly shotId: string;
  readonly sourceCommit: string;
  readonly status: RenderStatus;
  readonly artifact?: ProductionRenderArtifact;
  readonly mp4?: ProductionMp4Record;
  readonly diagnostics: readonly string[];
  readonly updatedAt: number;
}

interface LiveProductionRender {
  readonly renderer: PreparedProductionRenderer;
  record: PersistedProductionRender;
}

const referenceFiles = new Map<string, File>();
const live = new Map<string, LiveProductionRender>();
const persisted = new Map<string, PersistedProductionRender>();
const preparing = new Set<string>();
const exporting = new Set<string>();
let installed = false;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactBuildCommit(): string {
  return currentStudioBuildIdentity().commit;
}

function activeChatId(): string | null {
  try {
    const raw = localStorage.getItem("aistudio.runtime.chat-state.v1");
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return record(parsed) && typeof parsed.activeChatId === "string" ? parsed.activeChatId : null;
  } catch {
    return null;
  }
}

function loadPersisted(): void {
  try {
    const raw = localStorage.getItem(RENDER_STORAGE_KEY);
    if (raw === null) return;
    const values = JSON.parse(raw) as unknown;
    if (!Array.isArray(values)) return;
    const commit = exactBuildCommit();
    for (const value of values) {
      if (!record(value) || typeof value.chatId !== "string" || typeof value.projectId !== "string" || typeof value.shotId !== "string") continue;
      if (value.sourceCommit !== commit || typeof value.status !== "string" || typeof value.updatedAt !== "number") continue;
      if (!Array.isArray(value.diagnostics)) continue;
      const candidate = value as unknown as PersistedProductionRender;
      persisted.set(candidate.chatId, candidate);
    }
  } catch {
    // Exact-source render state is best effort. Live source pixels are never reconstructed from persistence.
  }
}

function persistRecords(): void {
  try {
    localStorage.setItem(RENDER_STORAGE_KEY, JSON.stringify([...persisted.values()]));
  } catch {
    // Rendering remains usable when local storage is unavailable.
  }
}

function productionRow(panel: HTMLElement, label: "Render" | "MP4 export"): HTMLElement | null {
  const rows = [...panel.querySelectorAll<HTMLElement>("[data-runtime-production-step]")];
  return rows.find((row) => row.textContent?.includes(label) === true) ?? null;
}

function markRow(panel: HTMLElement, label: "Render" | "MP4 export", complete: boolean, state: string): void {
  const row = productionRow(panel, label);
  if (row === null) return;
  row.dataset.complete = String(complete);
  const spans = row.querySelectorAll<HTMLElement>("span");
  if (spans[0] !== undefined) spans[0].textContent = complete ? "✓" : "○";
  if (spans[2] !== undefined) spans[2].textContent = state;
}

function ensureExportButton(panel: HTMLElement, chatId: string, status: RenderStatus): void {
  let button = panel.querySelector<HTMLButtonElement>("[data-runtime-production-export]");
  if (button === null) {
    button = document.createElement("button");
    button.type = "button";
    button.dataset.runtimeProductionExport = "true";
    button.style.minHeight = "40px";
    button.style.border = "1px solid #3a414c";
    button.style.borderRadius = "10px";
    button.style.background = "#eceff3";
    button.style.color = "#101217";
    button.style.cursor = "pointer";
    panel.append(button);
    button.addEventListener("click", () => void exportProductionMp4(chatId));
  }
  button.disabled = status === "EXPORTING" || status === "BLOCKED";
  button.textContent = status === "EXPORTING" ? "Encoding H.264 + Opus…" : status === "MP4_READY" ? "Export MP4 again" : "Export H.264 + Opus MP4";
}

function patchPanel(chatId: string): void {
  if (activeChatId() !== chatId) return;
  const state = live.get(chatId)?.record ?? persisted.get(chatId);
  if (state === undefined) return;
  const panel = document.querySelector<HTMLElement>("[data-runtime-production-status]");
  if (panel === null) return;
  panel.dataset.renderReady = String(state.status === "RENDER_READY" || state.status === "EXPORTING" || state.status === "MP4_READY");
  panel.dataset.mp4Ready = String(state.status === "MP4_READY");
  panel.dataset.renderSourceCommit = state.sourceCommit;
  markRow(panel, "Render", state.status !== "BLOCKED", state.status === "BLOCKED" ? "Blocked" : "Ready");
  markRow(panel, "MP4 export", state.status === "MP4_READY", state.status === "EXPORTING" ? "Encoding" : state.status === "MP4_READY" ? "Ready" : "Pending");

  let plan = panel.querySelector<HTMLElement>("[data-runtime-render-plan]");
  if (plan === null) {
    plan = document.createElement("div");
    plan.dataset.runtimeRenderPlan = "true";
    plan.style.fontSize = "10px";
    plan.style.lineHeight = "1.4";
    plan.style.color = "#aeb6c2";
    panel.append(plan);
  }
  if (state.artifact !== undefined) {
    const unique = new Set(state.artifact.temporalEvidence.map((item) => item.checksum)).size;
    plan.dataset.sourceCommit = state.sourceCommit;
    plan.textContent = `Render: exact-source 2D cutout · ${state.artifact.temporalEvidence.length} sampled frames · ${unique} distinct checksums · ${state.artifact.output.width}×${state.artifact.output.height} @ ${state.artifact.output.frameRate} fps`;
  } else {
    plan.textContent = state.diagnostics[0] ?? "Render is blocked.";
  }

  ensureExportButton(panel, chatId, state.status);
  const message = panel.querySelector<HTMLElement>("[data-runtime-production-message]");
  if (message !== null) {
    if (state.status === "MP4_READY") {
      const native = state.mp4?.nativeVerified === true ? " · Android native MP4 verification PASS" : "";
      message.textContent = `Rendered animated exact-source frames and completed H.264 + Opus MP4${native}.`;
    } else if (state.status === "EXPORTING") {
      message.textContent = "Encoding sampled production frames through the Studio H.264 + Opus MP4 path.";
    } else if (state.status === "RENDER_READY") {
      message.textContent = "Animated source-bound render evidence passed. H.264 + Opus MP4 export is ready.";
    } else {
      message.textContent = state.diagnostics[0] ?? "Production render is blocked.";
    }
  }
}

function storeRecord(value: PersistedProductionRender): void {
  persisted.set(value.chatId, value);
  const current = live.get(value.chatId);
  if (current !== undefined) current.record = value;
  persistRecords();
  patchPanel(value.chatId);
}

function block(chatId: string, message: string): void {
  const job = productionJobForChat(chatId);
  if (job === undefined) return;
  const previous = live.get(chatId);
  previous?.renderer.close();
  live.delete(chatId);
  storeRecord(Object.freeze({
    chatId,
    projectId: job.projectId,
    shotId: job.shotId,
    sourceCommit: exactBuildCommit(),
    status: "BLOCKED",
    diagnostics: Object.freeze([message]),
    updatedAt: Date.now(),
  }));
}

function onChatSubmit(event: Event): void {
  const detail = (event as CustomEvent<ChatSubmitDetail>).detail;
  if (detail === null || typeof detail !== "object" || typeof detail.chatId !== "string") return;
  const files = Array.isArray(detail.files) ? detail.files.filter((item): item is File => item instanceof File) : [];
  const reference = files.find((file) => file.type.startsWith("image/"));
  if (reference === undefined) referenceFiles.delete(detail.chatId);
  else referenceFiles.set(detail.chatId, reference);
  const previous = live.get(detail.chatId);
  previous?.renderer.close();
  live.delete(detail.chatId);
  persisted.delete(detail.chatId);
  persistRecords();
}

async function prepareForChat(chatId: string): Promise<void> {
  if (preparing.has(chatId)) return;
  const job = productionJobForChat(chatId);
  const camera = cameraExecutionForChat(chatId);
  const referenceFile = referenceFiles.get(chatId);
  if (job === undefined || camera === undefined) return;
  if (job.stage !== "PERFORMANCE_VALID" || job.blocking === undefined || job.rig === undefined || job.acting === undefined) return;
  if (camera.runtimeStage !== "READY_FOR_RENDER") return;
  if (referenceFile === undefined) {
    block(chatId, "Render requires the exact reference File from this live production submission; persisted metadata alone cannot reconstruct source pixels.");
    return;
  }
  const sourceCommit = exactBuildCommit();
  if (camera.sourceCommit !== sourceCommit) {
    block(chatId, "Camera execution belongs to a different Studio source commit.");
    return;
  }

  preparing.add(chatId);
  try {
    const prepared = await prepareProductionRenderer({
      blocking: job.blocking,
      rig: job.rig,
      acting: job.acting,
      camera: camera.artifact,
      sourceCommit,
    }, referenceFile);
    if (!prepared.ok) {
      block(chatId, prepared.diagnostics.join(" "));
      return;
    }
    const verified = verifyProductionTemporalMotion(prepared.renderer);
    if (!verified.ok) {
      prepared.renderer.close();
      block(chatId, verified.diagnostics.join(" "));
      return;
    }
    const previous = live.get(chatId);
    previous?.renderer.close();
    const recordValue: PersistedProductionRender = Object.freeze({
      chatId,
      projectId: job.projectId,
      shotId: job.shotId,
      sourceCommit,
      status: "RENDER_READY",
      artifact: verified.artifact,
      diagnostics: Object.freeze([...prepared.diagnostics, ...verified.diagnostics]),
      updatedAt: Date.now(),
    });
    live.set(chatId, { renderer: prepared.renderer, record: recordValue });
    storeRecord(recordValue);
    window.dispatchEvent(new CustomEvent("aistudio:render-ready", { detail: verified.artifact }));
  } finally {
    preparing.delete(chatId);
  }
}

function safeStem(value: string): string {
  const stem = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return stem.length > 0 ? stem.slice(0, 80) : "production";
}

function videoBitrate(width: number, height: number, frameRate: number): number {
  return Math.round(Math.min(12_000_000, Math.max(500_000, width * height * frameRate * 0.08)));
}

function estimatedBytes(durationSeconds: number, videoBitsPerSecond: number): number {
  return Math.max(1_048_576, Math.ceil((videoBitsPerSecond + AUDIO_BITRATE) * durationSeconds / 8 * 1.2));
}

function nativeVerificationIssues(
  finalization: StudioStreamingExportFinalization,
  width: number,
  height: number,
  durationSeconds: number,
): readonly string[] {
  if (finalization.nativeSave === null && finalization.nativeInspection === null) return Object.freeze([]);
  const issues: string[] = [];
  if (finalization.nativeSave === null) issues.push("Android native save result is missing.");
  const inspection = finalization.nativeInspection;
  if (inspection === null) issues.push("Android native MP4 inspection result is missing.");
  else {
    if (!inspection.videoTrackPresent) issues.push("Android inspection found no video track.");
    if (!inspection.audioTrackPresent) issues.push("Android inspection found no audio track.");
    if (!inspection.firstVideoFrameDecoded) issues.push("Android inspection could not decode the first video frame.");
    if (!inspection.deterministicPlaybackVerified) issues.push("Android deterministic playback verification failed.");
    if (inspection.width !== width || inspection.height !== height) issues.push(`Android inspection dimensions ${inspection.width}×${inspection.height} do not match ${width}×${height}.`);
    const expectedDurationMs = Math.round(durationSeconds * 1000);
    if (inspection.durationMs <= 0 || Math.abs(inspection.durationMs - expectedDurationMs) > Math.max(1200, expectedDurationMs * 0.08)) {
      issues.push(`Android inspection duration ${inspection.durationMs} ms does not match expected ${expectedDurationMs} ms.`);
    }
  }
  return Object.freeze(issues);
}

export async function exportProductionMp4(chatId: string): Promise<void> {
  if (exporting.has(chatId)) return;
  const execution = live.get(chatId);
  if (execution === undefined || execution.record.artifact === undefined) {
    block(chatId, "Production MP4 export requires a live exact-source renderer.");
    return;
  }
  if (execution.record.sourceCommit !== exactBuildCommit()) {
    block(chatId, "Production MP4 export source identity is stale.");
    return;
  }
  if (typeof OffscreenCanvas === "undefined" || typeof VideoFrame === "undefined" || typeof AudioData === "undefined") {
    block(chatId, "Production MP4 export requires OffscreenCanvas, VideoFrame and AudioData support.");
    return;
  }

  const artifact = execution.record.artifact;
  const { width, height, frameRate, durationSeconds } = artifact.output;
  const frameCount = Math.max(1, Math.round(durationSeconds * frameRate));
  const totalAudioFrames = Math.max(1, Math.round(durationSeconds * OPUS_SAMPLE_RATE));
  const bitrate = videoBitrate(width, height, frameRate);
  const fileStem = `production-${safeStem(chatId)}`;
  const fileName = `${fileStem}-timeline.mp4`;
  let target: StudioStreamingExportFile | undefined;
  let finalized = false;
  exporting.add(chatId);
  storeRecord(Object.freeze({ ...execution.record, status: "EXPORTING", updatedAt: Date.now() }));

  try {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Production MP4 export could not acquire a 2D canvas context.");
    target = await createStudioStreamingExportFile(fileStem, estimatedBytes(durationSeconds, bitrate));
    const result = await exportAvcOpusFragmentedMp4({
      width,
      height,
      frameRate,
      frameCount,
      videoBitrate: bitrate,
      keyFrameIntervalFrames: Math.max(1, Math.round(frameRate)),
      fragmentDurationSeconds: 1,
      numberOfChannels: 1,
      totalAudioFrames,
      audioChunkFrames: OPUS_CHUNK_FRAMES,
      audioBitrate: AUDIO_BITRATE,
      sink: target.sink,
      createFrame: (frameIndex: number, timestampUs: number, durationUs: number) => {
        const timeSeconds = frameIndex / frameRate;
        execution.renderer.renderFrame(context, Math.min(timeSeconds, durationSeconds), false);
        return new VideoFrame(canvas, { timestamp: timestampUs, duration: durationUs });
      },
      createAudioData: (_startFrame: number, frameCountForChunk: number, timestampUs: number) => new AudioData({
        format: "f32",
        sampleRate: OPUS_SAMPLE_RATE,
        numberOfFrames: frameCountForChunk,
        numberOfChannels: 1,
        timestamp: timestampUs,
        data: new Float32Array(frameCountForChunk),
      }),
    });
    if (result.encodedVideoChunks <= 0 || result.encodedAudioChunks <= 0 || result.bytesWritten <= 0) {
      throw new Error("H.264 + Opus encoder returned an empty production MP4.");
    }
    const finalization = await target.finalize(result.mimeType, fileName);
    finalized = true;
    if (finalization.size <= 0) throw new Error("Finalized production MP4 is empty.");
    const nativeIssues = nativeVerificationIssues(finalization, width, height, durationSeconds);
    if (nativeIssues.length > 0) throw new Error(nativeIssues.join(" "));
    const nativeVerified = finalization.nativeInspection === null ? null : true;
    const mp4: ProductionMp4Record = Object.freeze({
      mimeType: result.mimeType,
      videoCodec: result.videoCodec,
      audioCodec: result.audioCodec,
      bytesWritten: finalization.size,
      encodedVideoChunks: result.encodedVideoChunks,
      encodedAudioChunks: result.encodedAudioChunks,
      fragmentsWritten: result.fragmentsWritten,
      nativeSha256: finalization.nativeSave?.sha256 ?? null,
      nativeUri: finalization.nativeSave?.uri ?? null,
      nativeVerified,
      nativeInspectionNote: finalization.nativeInspection?.note ?? null,
    });
    storeRecord(Object.freeze({
      ...execution.record,
      status: "MP4_READY",
      mp4,
      diagnostics: Object.freeze([
        ...execution.record.diagnostics,
        `Encoded ${result.encodedVideoChunks} H.264 chunks and ${result.encodedAudioChunks} Opus chunks into ${result.fragmentsWritten} MP4 fragments.`,
        ...(nativeVerified === true ? ["Android native save, track inspection, first-frame decode and deterministic playback verification passed."] : []),
      ]),
      updatedAt: Date.now(),
    }));
    window.dispatchEvent(new CustomEvent("aistudio:production-mp4-ready", { detail: mp4 }));
  } catch (error) {
    if (target !== undefined && !finalized) {
      try { await target.abort(error); } catch { /* preserve primary failure */ }
    }
    storeRecord(Object.freeze({
      ...execution.record,
      status: "RENDER_READY",
      diagnostics: Object.freeze([
        ...execution.record.diagnostics,
        error instanceof Error ? error.message : "Production H.264 + Opus MP4 export failed.",
      ]),
      updatedAt: Date.now(),
    }));
  } finally {
    exporting.delete(chatId);
    patchPanel(chatId);
  }
}

function onCameraReady(event: Event): void {
  const detail = (event as CustomEvent<{ readonly chatId?: unknown }>).detail;
  if (detail !== null && typeof detail === "object" && typeof detail.chatId === "string") {
    void prepareForChat(detail.chatId);
  }
}

function syncActive(): void {
  const chatId = activeChatId();
  if (chatId === null) return;
  patchPanel(chatId);
  if (live.get(chatId) === undefined) void prepareForChat(chatId);
}

export function productionRenderForChat(chatId: string): PersistedProductionRender | undefined {
  return live.get(chatId)?.record ?? persisted.get(chatId);
}

export function installStudioProductionRender(): void {
  if (installed) return;
  installed = true;
  loadPersisted();
  window.addEventListener("aistudio:chat-submit", onChatSubmit);
  window.addEventListener("aistudio:camera-ready", onCameraReady);
  window.addEventListener("aistudio:runtime-show-chat", syncActive);
  window.addEventListener("aistudio:runtime-ready", syncActive);
  document.addEventListener("click", () => window.setTimeout(syncActive, 0), true);
  window.setTimeout(syncActive, 0);
}

installStudioProductionRender();
