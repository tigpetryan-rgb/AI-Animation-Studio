import { exportAvcOpusMp4 } from "@aistudio/media-export/mp4";

const EXPORT_WIDTH = 320;
const EXPORT_HEIGHT = 180;
const EXPORT_FRAME_RATE = 12;
const EXPORT_DURATION_SECONDS = 2;
const EXPORT_FRAME_COUNT = EXPORT_FRAME_RATE * EXPORT_DURATION_SECONDS;
const EXPORT_SAMPLE_RATE = 48_000;
const EXPORT_TOTAL_AUDIO_FRAMES = EXPORT_SAMPLE_RATE * EXPORT_DURATION_SECONDS;
const EXPORT_AUDIO_CHUNK_FRAMES = 960;

interface ExportPanelState {
  phase: "IDLE" | "RUNNING" | "SUCCESS" | "ERROR";
  progress: number;
  message: string;
}

let state: ExportPanelState = {
  phase: "IDLE",
  progress: 0,
  message: "Open the local demo project to export an MP4 preview.",
};
let syncQueued = false;

function currentProjectId(): string | null {
  const assets = document.querySelector<HTMLElement>(".assets-panel");
  if (assets === null) return null;
  const value = assets.querySelector<HTMLElement>("p.muted")?.textContent?.trim() ?? "";
  if (value.length === 0 || value === "No project open") return null;
  return value;
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
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileStem(projectId)}-preview.mp4`;
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

async function exportProjectPreview(projectId: string): Promise<void> {
  updateState({
    phase: "RUNNING",
    progress: 1,
    message: "Preparing MP4 export…",
  });

  try {
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("OffscreenCanvas is unavailable in this browser.");
    }

    const canvas = new OffscreenCanvas(EXPORT_WIDTH, EXPORT_HEIGHT);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("2D canvas context is unavailable.");

    const exported = await exportAvcOpusMp4({
      width: EXPORT_WIDTH,
      height: EXPORT_HEIGHT,
      frameRate: EXPORT_FRAME_RATE,
      frameCount: EXPORT_FRAME_COUNT,
      videoBitrate: 500_000,
      numberOfChannels: 1,
      totalAudioFrames: EXPORT_TOTAL_AUDIO_FRAMES,
      audioChunkFrames: EXPORT_AUDIO_CHUNK_FRAMES,
      audioBitrate: 64_000,
      createFrame: (index, timestampUs, durationUs) => {
        const progress = (index + 1) / EXPORT_FRAME_COUNT;
        const x = Math.round(progress * (EXPORT_WIDTH - 48));

        context.fillStyle = index % 2 === 0 ? "rgb(22, 28, 44)" : "rgb(28, 36, 54)";
        context.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
        context.fillStyle = "rgb(235, 240, 250)";
        context.font = "bold 20px sans-serif";
        context.fillText("AI Animation Studio", 20, 38);
        context.font = "14px sans-serif";
        context.fillText(projectId, 20, 64);
        context.fillStyle = "rgb(88, 166, 255)";
        context.fillRect(20, 112, x, 12);
        context.fillStyle = "rgb(235, 240, 250)";
        context.fillRect(20 + ((index * 11) % 250), 136, 28, 24);

        updateState({
          progress: Math.max(state.progress, Math.round(progress * 70)),
          message: `Encoding video… ${index + 1}/${EXPORT_FRAME_COUNT}`,
        });
        return new VideoFrame(canvas, { timestamp: timestampUs, duration: durationUs });
      },
      createAudioData: (startFrame, frameCount, timestampUs) => {
        const samples = new Float32Array(frameCount);
        for (let frame = 0; frame < frameCount; frame += 1) {
          const absoluteFrame = startFrame + frame;
          samples[frame] = Math.sin((2 * Math.PI * 440 * absoluteFrame) / EXPORT_SAMPLE_RATE) * 0.12;
        }
        const audioProgress = (startFrame + frameCount) / EXPORT_TOTAL_AUDIO_FRAMES;
        updateState({
          progress: Math.max(state.progress, 70 + Math.round(audioProgress * 25)),
          message: "Encoding audio…",
        });
        return new AudioData({
          format: "f32",
          sampleRate: EXPORT_SAMPLE_RATE,
          numberOfFrames: frameCount,
          numberOfChannels: 1,
          timestamp: timestampUs,
          data: samples,
        });
      },
    });

    updateState({ progress: 98, message: "Preparing download…" });
    downloadMp4(exported.bytes, exported.mimeType, projectId);
    updateState({
      phase: "SUCCESS",
      progress: 100,
      message: `MP4 ready · ${exported.encodedVideoChunks} video chunks · ${exported.encodedAudioChunks} audio chunks`,
    });
  } catch (error) {
    updateState({
      phase: "ERROR",
      progress: 0,
      message: error instanceof Error ? error.message : "MP4 export failed.",
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
  heading.textContent = "Export";

  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = "M33 preview slice: exports a real 2-second H.264 + Opus MP4. Canonical timeline composition comes next.";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary";
  button.dataset.exportMp4Button = "true";
  button.addEventListener("click", () => {
    const projectId = currentProjectId();
    if (projectId !== null && state.phase !== "RUNNING") {
      void exportProjectPreview(projectId);
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
  if (button === null || progress === null || status === null) return;

  const projectId = currentProjectId();
  const running = state.phase === "RUNNING";
  button.disabled = projectId === null || running;
  setText(button, running ? `Exporting… ${state.progress}%` : "Export MP4 preview");
  progress.value = state.progress;
  progress.hidden = state.phase === "IDLE" && projectId === null;
  status.dataset.exportPhase = state.phase;

  if (projectId === null && state.phase !== "RUNNING") {
    setText(status, "Open the local demo project to export an MP4 preview.");
  } else {
    setText(status, state.message);
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
