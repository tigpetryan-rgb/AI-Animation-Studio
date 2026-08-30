import { currentStudioBuildIdentity } from "./device-check";
import {
  advancePhysicalDeviceWorkflowCapture,
  createPhysicalDeviceWorkflowCaptureState,
  inspectMp4TrackPresence,
  physicalDeviceSaveEvidence,
  type PhysicalDeviceWorkflowCaptureState,
} from "./physical-device-evidence-capture";
import {
  classifyPhysicalDeviceExportEvidence,
  validatePhysicalDeviceExportEvidence,
  type PhysicalDeviceExportReport,
  type PhysicalDevicePlaybackEvidence,
} from "./physical-device-export-evidence";
import { movieSessionForProjectId, type StudioMovieSession } from "./studio-movie-session";

interface VerifiedMp4 {
  readonly bytes: number;
  readonly sha256: string;
  readonly playback: PhysicalDevicePlaybackEvidence;
  readonly filename: string;
}

const studioBuild = currentStudioBuildIdentity();
let workflowCapture: PhysicalDeviceWorkflowCaptureState = createPhysicalDeviceWorkflowCaptureState();
let verifiedMp4: VerifiedMp4 | null = null;
let mp4Error: string | null = null;
let syncQueued = false;

function currentProjectId(): string | null {
  const value = document.querySelector<HTMLElement>(".assets-panel > h2 + p")?.textContent?.trim() ?? "";
  return value.length === 0 || value === "No project open" ? null : value;
}

function currentSession(): StudioMovieSession | null {
  return movieSessionForProjectId(currentProjectId());
}

function timelineSignature(session: StudioMovieSession): string {
  return session.timeline.tracks
    .flatMap((track) => track.clips.map((clip) => [
      track.id,
      clip.id,
      clip.assetId,
      clip.timelineStart.value.toString(),
      clip.timelineStart.timescale.toString(),
      clip.sourceIn.value.toString(),
      clip.sourceIn.timescale.toString(),
      clip.duration.value.toString(),
      clip.duration.timescale.toString(),
    ].join("|")))
    .join(";");
}

function updateWorkflowCapture(): void {
  const session = currentSession();
  workflowCapture = advancePhysicalDeviceWorkflowCapture(workflowCapture, {
    projectId: session?.project.projectId ?? null,
    timelineSignature: session === null ? null : timelineSignature(session),
    projectStatus: document.querySelector<HTMLElement>("[data-project-file-status]")?.textContent?.trim() ?? "",
    exportStatus: document.querySelector<HTMLElement>("[data-export-mp4-status]")?.textContent?.trim() ?? "",
  });
}

function setText(node: HTMLElement | null, value: string): void {
  if (node !== null && node.textContent !== value) node.textContent = value;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function waitForEvent(target: EventTarget, name: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${name}.`));
    }, timeoutMs);
    const onEvent = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error(`Media ${name} verification failed.`));
    };
    const cleanup = (): void => {
      window.clearTimeout(timer);
      target.removeEventListener(name, onEvent);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(name, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

async function verifyMp4(file: File): Promise<VerifiedMp4> {
  if (file.size <= 0) throw new Error("Selected MP4 is empty.");
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const tracks = inspectMp4TrackPresence(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const sha256 = bytesToHex(new Uint8Array(digest));
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.style.display = "none";
  document.body.append(video);

  let metadataLoaded = false;
  let playbackProgressed = false;
  try {
    video.src = url;
    const metadataEvent = waitForEvent(video, "loadedmetadata", 8_000);
    video.load();
    await metadataEvent;
    metadataLoaded = Number.isFinite(video.duration)
      && video.duration > 0
      && video.videoWidth > 0
      && video.videoHeight > 0;
    await video.play();
    if (video.currentTime <= 0.05) await waitForEvent(video, "timeupdate", 8_000);
    playbackProgressed = video.currentTime > 0;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }

  return {
    bytes: file.size,
    sha256,
    filename: file.name,
    playback: {
      metadataLoaded,
      playbackProgressed,
      videoTrackPresent: tracks.videoTrackPresent,
      audioTrackPresent: tracks.audioTrackPresent,
    },
  };
}

function inputValue(panel: HTMLElement, key: string): string {
  return panel.querySelector<HTMLInputElement>(`[data-physical-${key}]`)?.value.trim() ?? "";
}

function exportEvidence(): PhysicalDeviceExportReport["export"] {
  if (verifiedMp4 !== null) {
    return {
      disposition: "EXPORTED",
      exportControlDisabled: false,
      reason: `Verified downloaded MP4 ${verifiedMp4.filename}.`,
      outputBytes: verifiedMp4.bytes,
      outputSha256: verifiedMp4.sha256,
      playback: verifiedMp4.playback,
    };
  }

  const exportButton = document.querySelector<HTMLButtonElement>("[data-export-mp4-button]");
  const compatibility = document.querySelector<HTMLElement>("[data-export-capability-summary]");
  const unsupported = exportButton?.disabled === true
    && compatibility?.dataset.exportSelectedSupported === "false";
  if (unsupported) {
    return {
      disposition: "UNSUPPORTED",
      exportControlDisabled: true,
      reason: compatibility?.textContent?.trim() || "MP4 export is unsupported on this device.",
      outputBytes: 0,
      outputSha256: null,
      playback: {
        metadataLoaded: false,
        playbackProgressed: false,
        videoTrackPresent: false,
        audioTrackPresent: false,
      },
    };
  }

  return {
    disposition: "FAILED",
    exportControlDisabled: exportButton?.disabled ?? true,
    reason: mp4Error ?? "No verified MP4 output or explicit unsupported capability boundary was captured.",
    outputBytes: 0,
    outputSha256: null,
    playback: {
      metadataLoaded: false,
      playbackProgressed: false,
      videoTrackPresent: false,
      audioTrackPresent: false,
    },
  };
}

function downloadReport(report: PhysicalDeviceExportReport): void {
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `aistudio-physical-device-${report.capturedAt.replaceAll(":", "-")}.json`;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function generateReport(panel: HTMLElement): void {
  updateWorkflowCapture();
  const result = panel.querySelector<HTMLElement>("[data-physical-result]");
  if (navigator.webdriver === true) {
    setText(result, "Automated/WebDriver sessions are rejected as physical-device evidence.");
    return;
  }
  const physicalConfirmed = panel.querySelector<HTMLInputElement>("[data-physical-confirm]")?.checked === true;
  if (!physicalConfirmed) {
    setText(result, "Physical-device confirmation is required. Emulated evidence is intentionally rejected.");
    return;
  }

  const report: PhysicalDeviceExportReport = {
    schemaVersion: 1,
    build: studioBuild,
    capturedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    device: {
      platform: inputValue(panel, "platform"),
      model: inputValue(panel, "model"),
      osVersion: inputValue(panel, "os-version"),
      browser: inputValue(panel, "browser"),
      browserVersion: inputValue(panel, "browser-version"),
      emulated: false,
    },
    projectId: currentProjectId() ?? "",
    save: physicalDeviceSaveEvidence(workflowCapture),
    export: exportEvidence(),
  };

  const validation = validatePhysicalDeviceExportEvidence(report, studioBuild);
  if (!validation.ok) {
    setText(result, validation.issues.join(" "));
    return;
  }

  const mode = classifyPhysicalDeviceExportEvidence(validation.report);
  if (mode === "FAILED") {
    setText(result, "Evidence is structurally valid but the production workflow is FAILED; no passing report was downloaded.");
    return;
  }

  downloadReport(validation.report);
  setText(result, `Physical-device evidence: ${mode}. Exact build ${studioBuild.commit.slice(0, 12)}.`);
}

function createTextInput(key: string, labelText: string, placeholder: string): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "export-setting";
  const caption = document.createElement("span");
  caption.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  input.dataset[`physical${key.split("-").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join("")}`] = "true";
  label.append(caption, input);
  return label;
}

function ensurePanel(): HTMLElement | null {
  const inspector = document.querySelector<HTMLElement>(".panel.inspector");
  if (inspector === null) return null;
  const existing = inspector.querySelector<HTMLElement>("[data-physical-device-evidence-panel]");
  if (existing !== null) return existing;

  const panel = document.createElement("section");
  panel.dataset.physicalDeviceEvidencePanel = "true";
  panel.className = "physical-device-evidence-panel";

  const heading = document.createElement("h3");
  heading.textContent = "Physical-device production evidence";
  const note = document.createElement("p");
  note.className = "verification-note";
  note.textContent = "Real hardware only. Edit → save .aistudio → reopen it. For supported MP4 export, select the downloaded MP4 so this build can verify SHA-256, playback, and ISO BMFF video/audio track declarations.";

  const grid = document.createElement("div");
  grid.className = "export-settings-grid";
  grid.append(
    createTextInput("platform", "Platform", navigator.platform || "Windows / Android / iOS"),
    createTextInput("model", "Device model", "Exact device model"),
    createTextInput("os-version", "OS version", "Exact OS version"),
    createTextInput("browser", "Browser", "Chrome / Safari / Edge"),
    createTextInput("browser-version", "Browser version", "Exact browser version"),
  );

  const confirmLabel = document.createElement("label");
  const confirm = document.createElement("input");
  confirm.type = "checkbox";
  confirm.dataset.physicalConfirm = "true";
  confirmLabel.append(confirm, document.createTextNode(" I confirm this run is on physical hardware, not emulation."));

  const mp4Input = document.createElement("input");
  mp4Input.type = "file";
  mp4Input.accept = "video/mp4,.mp4";
  mp4Input.dataset.physicalMp4Input = "true";
  mp4Input.addEventListener("change", () => {
    const file = mp4Input.files?.[0];
    if (file === undefined) return;
    verifiedMp4 = null;
    mp4Error = null;
    setText(panel.querySelector("[data-physical-mp4-status]"), "Verifying selected MP4…");
    void verifyMp4(file).then((verified) => {
      verifiedMp4 = verified;
      mp4Error = null;
      scheduleSync();
    }).catch((error: unknown) => {
      verifiedMp4 = null;
      mp4Error = error instanceof Error ? error.message : "MP4 verification failed.";
      scheduleSync();
    });
  });

  const workflow = document.createElement("p");
  workflow.className = "muted";
  workflow.dataset.physicalWorkflowStatus = "true";
  const mp4Status = document.createElement("p");
  mp4Status.className = "muted";
  mp4Status.dataset.physicalMp4Status = "true";

  const generate = document.createElement("button");
  generate.type = "button";
  generate.textContent = "Download physical-device evidence";
  generate.dataset.physicalGenerateReport = "true";
  generate.addEventListener("click", () => generateReport(panel));

  const result = document.createElement("p");
  result.className = "verification-note";
  result.dataset.physicalResult = "true";
  result.setAttribute("role", "status");

  panel.append(heading, note, grid, confirmLabel, mp4Input, workflow, mp4Status, generate, result);
  inspector.append(panel);
  return panel;
}

function syncPanel(): void {
  syncQueued = false;
  updateWorkflowCapture();
  const panel = ensurePanel();
  if (panel === null) return;
  const save = physicalDeviceSaveEvidence(workflowCapture);
  setText(
    panel.querySelector("[data-physical-workflow-status]"),
    `Workflow · open ${save.openedProject ? "✓" : "–"} · edit ${save.timelineEdited ? "✓" : "–"} · save ${save.packageSaved ? "✓" : "–"} · reopen ${save.packageReopened ? "✓" : "–"} · preserved ${save.editPreserved ? "✓" : "–"}`,
  );
  if (verifiedMp4 !== null) {
    const playback = verifiedMp4.playback;
    setText(
      panel.querySelector("[data-physical-mp4-status]"),
      `MP4 ${verifiedMp4.bytes} bytes · SHA-256 ${verifiedMp4.sha256.slice(0, 12)}… · metadata ${playback.metadataLoaded ? "✓" : "✗"} · playback ${playback.playbackProgressed ? "✓" : "✗"} · video ${playback.videoTrackPresent ? "✓" : "✗"} · audio ${playback.audioTrackPresent ? "✓" : "✗"}`,
    );
  } else {
    setText(
      panel.querySelector("[data-physical-mp4-status]"),
      mp4Error ?? "No MP4 selected. An explicit disabled/unsupported export path can still produce SAFE_FALLBACK evidence.",
    );
  }
  if (navigator.webdriver === true) {
    setText(panel.querySelector("[data-physical-result]"), "WebDriver detected: this session cannot generate physical-device evidence.");
  }
}

function scheduleSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  window.setTimeout(syncPanel, 0);
}

export function installPhysicalDeviceEvidenceUi(): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (root !== null) {
    const observer = new MutationObserver(scheduleSync);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }
  window.addEventListener("aistudio:movie-session-change", scheduleSync);
  scheduleSync();
}

installPhysicalDeviceEvidenceUi();
