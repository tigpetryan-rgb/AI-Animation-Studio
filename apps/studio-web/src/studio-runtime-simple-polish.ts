import {
  createLocalDemoMovieSession,
  movieSessionForProjectId,
  type StudioMovieSession,
} from "./studio-movie-session";

let syncQueued = false;
const demoBaseline = createLocalDemoMovieSession();

function currentProjectId(): string | null {
  const value = document.querySelector<HTMLElement>(".assets-panel > h2 + p")?.textContent?.trim() ?? "";
  return value.length === 0 || value === "No project open" ? null : value;
}

function currentSession(): StudioMovieSession | null {
  const projectId = currentProjectId();
  return projectId === null ? null : movieSessionForProjectId(projectId);
}

function timelineEditSignature(session: StudioMovieSession): string {
  return session.timeline.tracks
    .filter((track) => track.kind === "video" || track.kind === "audio")
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

function hasTimelineEdit(session: StudioMovieSession): boolean {
  if (session.project.projectId !== demoBaseline.project.projectId) return false;
  return timelineEditSignature(session) !== timelineEditSignature(demoBaseline);
}

function setText(node: HTMLElement | null, value: string): void {
  if (node !== null && node.textContent !== value) node.textContent = value;
}

function ensureStyles(): void {
  if (document.querySelector("style[data-runtime-simple-polish]") !== null) return;
  const style = document.createElement("style");
  style.dataset.runtimeSimplePolish = "true";
  style.textContent = `
    html.runtime-simple-ui[data-runtime-project-open="true"] .project-file-controls {
      display: none !important;
    }

    html.runtime-simple-ui [data-timeline-edit-action="slip-back"],
    html.runtime-simple-ui [data-timeline-edit-action="slip-forward"] {
      display: none !important;
    }

    html.runtime-simple-ui .timeline-editbar {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      align-items: center;
    }

    html.runtime-simple-ui .timeline-editbar [data-timeline-selection] {
      grid-column: 1 / -1;
      color: #929bab;
      font-size: 12px;
      line-height: 1.4;
    }

    html.runtime-simple-ui .timeline-editbar [data-timeline-edit-action] {
      min-height: 44px;
      border-radius: 14px;
    }

    html.runtime-simple-ui [data-runtime-simple-step] {
      padding: 10px 12px;
      border: 1px solid #1d222c;
      border-radius: 14px;
      background: #0b0d12;
      color: #a6afbd;
      line-height: 1.4;
    }

    html.runtime-simple-ui [data-runtime-simple-step][data-edit-present="true"] {
      border-color: #31483a;
      color: #b9d7c2;
    }

    html.runtime-simple-ui .studio-export-panel [data-export-mp4-status][data-export-phase="IDLE"] {
      display: none !important;
    }

    html.runtime-simple-ui .studio-export-panel [data-cancel-export-button][hidden] {
      display: none !important;
    }

    html.runtime-simple-ui .timeline-track-label {
      font-size: 10px;
      color: #737d8e;
    }

    html.runtime-simple-ui .timeline-toolbar {
      gap: 10px;
    }

    html.runtime-simple-ui .timeline-toolbar .timecode {
      font-size: 10px;
      color: #858e9f;
    }
  `;
  document.head.append(style);
}

function simplifyTimelineControls(): void {
  const trimStart = document.querySelector<HTMLButtonElement>("[data-timeline-edit-action=\"trim-in\"]");
  const trimEnd = document.querySelector<HTMLButtonElement>("[data-timeline-edit-action=\"trim-out\"]");
  if (trimStart !== null) trimStart.textContent = "Trim start";
  if (trimEnd !== null) trimEnd.textContent = "Trim end";

  const selected = document.querySelector<HTMLElement>("[data-timeline-selection]");
  if (selected?.textContent === "Select a clip to edit") setText(selected, "Tap a clip to edit");
}

function orderPrimaryActions(): void {
  const panel = document.querySelector<HTMLElement>("[data-studio-export-panel]");
  const save = panel?.querySelector<HTMLButtonElement>("[data-save-aistudio-button]");
  const exportButton = panel?.querySelector<HTMLButtonElement>("[data-export-mp4-button]");
  if (panel !== null && panel !== undefined && save !== null && save !== undefined && exportButton !== null && exportButton !== undefined) {
    if (save.nextElementSibling !== exportButton) panel.insertBefore(save, exportButton);
  }
}

function updateGuidance(): void {
  const step = document.querySelector<HTMLElement>("[data-runtime-simple-step]");
  if (step === null) return;

  const session = currentSession();
  if (session === null) {
    step.dataset.editPresent = "false";
    setText(step, "Step 1 · Open a project");
    return;
  }

  const edited = hasTimelineEdit(session);
  step.dataset.editPresent = String(edited);
  setText(
    step,
    edited
      ? "Timeline edit detected ✓ · Save project, then reopen it to verify"
      : "Step 2 · Tap a clip, then use Trim start or Trim end",
  );
}

function syncPolish(): void {
  syncQueued = false;
  if (window.AIStudioRuntime === undefined) return;
  ensureStyles();
  simplifyTimelineControls();
  orderPrimaryActions();
  updateGuidance();
}

function scheduleSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  window.setTimeout(syncPolish, 0);
}

window.addEventListener("aistudio:runtime-ready", scheduleSync);
window.addEventListener("aistudio:movie-session-change", scheduleSync);
document.addEventListener("click", scheduleSync, true);
document.addEventListener("change", scheduleSync, true);
new MutationObserver(scheduleSync).observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
});
scheduleSync();
