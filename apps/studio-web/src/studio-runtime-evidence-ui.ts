import {
  createStudioRuntimeCertificationEvidence,
  validateStudioRuntimeCertificationEvidence,
} from "./studio-runtime-evidence";
import type {
  StudioRuntimeMp4Inspection,
  StudioRuntimeNativeSaveResult,
} from "./studio-runtime-bridge";

interface NativeExportFinalizedDetail {
  readonly nativeSave: StudioRuntimeNativeSaveResult;
  readonly nativeInspection: StudioRuntimeMp4Inspection;
}

let latestNativeExport: NativeExportFinalizedDetail | null = null;
let syncQueued = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function currentProjectId(): string | null {
  const value = document.querySelector<HTMLElement>(".assets-panel > h2 + p")?.textContent?.trim() ?? "";
  return value.length === 0 || value === "No project open" ? null : value;
}

function setText(node: HTMLElement | null, value: string): void {
  if (node !== null && node.textContent !== value) node.textContent = value;
}

function readNativeExportDetail(input: unknown): NativeExportFinalizedDetail | null {
  if (!isRecord(input) || !isRecord(input.nativeSave) || !isRecord(input.nativeInspection)) return null;
  return {
    nativeSave: input.nativeSave as unknown as StudioRuntimeNativeSaveResult,
    nativeInspection: input.nativeInspection as unknown as StudioRuntimeMp4Inspection,
  };
}

function ensurePanel(): HTMLElement | null {
  const runtime = window.AIStudioRuntime;
  const inspector = document.querySelector<HTMLElement>(".panel.inspector");
  if (runtime === undefined || inspector === null) return null;

  const existing = inspector.querySelector<HTMLElement>("[data-studio-runtime-evidence-panel]");
  if (existing !== null) return existing;

  const panel = document.createElement("section");
  panel.dataset.studioRuntimeEvidencePanel = "true";
  panel.className = "physical-device-evidence-panel";

  const heading = document.createElement("h3");
  heading.textContent = "Android Runtime certification";

  const note = document.createElement("p");
  note.className = "verification-note";
  note.textContent = "Controlled-runtime evidence is filled from the native Android bridge. Export one MP4, confirm this is observed physical hardware, then save the exact-build evidence JSON.";

  const runtimeStatus = document.createElement("p");
  runtimeStatus.className = "muted";
  runtimeStatus.dataset.studioRuntimeStatus = "true";

  const exportStatus = document.createElement("p");
  exportStatus.className = "muted";
  exportStatus.dataset.studioRuntimeExportStatus = "true";

  const confirmLabel = document.createElement("label");
  const confirm = document.createElement("input");
  confirm.type = "checkbox";
  confirm.dataset.studioRuntimePhysicalConfirm = "true";
  confirmLabel.append(confirm, document.createTextNode(" I confirm this run is on observed physical hardware, not an emulator/simulator."));

  const saveEvidence = document.createElement("button");
  saveEvidence.type = "button";
  saveEvidence.textContent = "Save Android Runtime evidence";
  saveEvidence.dataset.studioRuntimeSaveEvidence = "true";
  saveEvidence.addEventListener("click", () => {
    void saveRuntimeEvidence(panel);
  });

  const result = document.createElement("p");
  result.className = "verification-note";
  result.dataset.studioRuntimeEvidenceResult = "true";
  result.setAttribute("role", "status");

  panel.append(heading, note, runtimeStatus, exportStatus, confirmLabel, saveEvidence, result);
  inspector.append(panel);
  return panel;
}

async function saveRuntimeEvidence(panel: HTMLElement): Promise<void> {
  const result = panel.querySelector<HTMLElement>("[data-studio-runtime-evidence-result]");
  const runtime = window.AIStudioRuntime;
  if (runtime === undefined) {
    setText(result, "Validated Android Runtime bridge is unavailable.");
    return;
  }
  if (navigator.webdriver === true) {
    setText(result, "Automated/WebDriver sessions are rejected as physical-device certification evidence.");
    return;
  }
  if (latestNativeExport === null) {
    setText(result, "Export a native MP4 first so SHA-256 and decoder verification can be bound to the report.");
    return;
  }

  const projectId = currentProjectId();
  if (projectId === null) {
    setText(result, "Open a Studio project before creating Runtime certification evidence.");
    return;
  }

  const physicalHardwareConfirmed = panel.querySelector<HTMLInputElement>("[data-studio-runtime-physical-confirm]")?.checked === true;
  const report = createStudioRuntimeCertificationEvidence(
    runtime.info,
    latestNativeExport.nativeSave,
    latestNativeExport.nativeInspection,
    projectId,
    physicalHardwareConfirmed,
    new Date().toISOString(),
    navigator.userAgent,
  );
  const validation = validateStudioRuntimeCertificationEvidence(report);
  if (!validation.ok) {
    setText(result, validation.issues.join(" "));
    return;
  }

  const json = `${JSON.stringify(validation.report, null, 2)}\n`;
  const fileName = `aistudio-runtime-evidence-${validation.report.capturedAt.replaceAll(":", "-")}.json`;
  try {
    const saved = await runtime.saveBlob(fileName, "application/json", new Blob([json], { type: "application/json" }));
    setText(
      result,
      `Runtime evidence saved · ${saved.bytesWritten} bytes · SHA-256 ${saved.sha256.slice(0, 12)}… · exact Studio ${runtime.info.studioCommitSha.slice(0, 12)}.`,
    );
  } catch (error) {
    setText(result, error instanceof Error ? `Runtime evidence save failed: ${error.message}` : "Runtime evidence save failed.");
  }
}

function syncPanel(): void {
  syncQueued = false;
  const panel = ensurePanel();
  const runtime = window.AIStudioRuntime;
  if (panel === null || runtime === undefined) return;

  setText(
    panel.querySelector("[data-studio-runtime-status]"),
    `Runtime · ${runtime.info.manufacturer} ${runtime.info.model} · Android ${runtime.info.androidRelease} / API ${runtime.info.androidSdkInt} · WebView ${runtime.info.webViewVersion ?? "unknown"} · Studio ${runtime.info.studioCommitSha.slice(0, 12)} · physical candidate ${runtime.info.physicalDeviceCandidate ? "✓" : "✗"}`,
  );

  const button = panel.querySelector<HTMLButtonElement>("[data-studio-runtime-save-evidence]");
  if (latestNativeExport === null) {
    setText(
      panel.querySelector("[data-studio-runtime-export-status]"),
      "Native export · none captured yet. Export MP4 from this Runtime to run the native decoder gate.",
    );
    if (button !== null) button.disabled = true;
    return;
  }

  const inspection = latestNativeExport.nativeInspection;
  setText(
    panel.querySelector("[data-studio-runtime-export-status]"),
    `Native export · ${latestNativeExport.nativeSave.bytesWritten} bytes · SHA-256 ${latestNativeExport.nativeSave.sha256.slice(0, 12)}… · video ${inspection.videoTrackPresent ? "✓" : "✗"} · audio ${inspection.audioTrackPresent ? "✓" : "✗"} · first frame ${inspection.firstVideoFrameDecoded ? "✓" : "✗"} · decoder gate ${inspection.deterministicPlaybackVerified ? "✓" : "✗"}`,
  );
  if (button !== null) button.disabled = false;
}

function scheduleSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(syncPanel);
}

window.addEventListener("aistudio:runtime-ready", scheduleSync);
window.addEventListener("aistudio:native-export-finalized", (event) => {
  const detail = readNativeExportDetail((event as CustomEvent<unknown>).detail);
  if (detail !== null) latestNativeExport = detail;
  scheduleSync();
});

document.addEventListener("click", scheduleSync, true);
document.addEventListener("change", scheduleSync, true);
new MutationObserver(scheduleSync).observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
});
scheduleSync();
