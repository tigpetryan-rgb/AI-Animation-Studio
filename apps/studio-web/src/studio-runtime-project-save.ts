import { exportMovieSessionPackage } from "./studio-session-package";
import { movieSessionForProjectId, type StudioMovieSession } from "./studio-movie-session";

function currentProjectId(): string | null {
  const assets = document.querySelector<HTMLElement>(".assets-panel");
  const value = assets?.querySelector<HTMLElement>("p.muted")?.textContent?.trim() ?? "";
  return value.length === 0 || value === "No project open" ? null : value;
}

function safeFileStem(value: string): string {
  const stem = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return stem.length > 0 ? stem : "aistudio-project";
}

function setSaveUi(
  button: HTMLButtonElement,
  phase: "RUNNING" | "SUCCESS" | "ERROR",
  message: string,
): void {
  const panel = button.closest<HTMLElement>("[data-studio-export-panel]");
  const status = panel?.querySelector<HTMLElement>("[data-export-mp4-status]");
  const progress = panel?.querySelector<HTMLProgressElement>("[data-export-mp4-progress]");
  if (status !== null && status !== undefined) {
    status.dataset.exportPhase = phase;
    status.dataset.exportOperation = phase === "RUNNING" ? "SAVE" : "NONE";
    status.textContent = message;
  }
  if (progress !== null && progress !== undefined) {
    progress.hidden = false;
    progress.value = phase === "RUNNING" ? 10 : phase === "SUCCESS" ? 100 : 0;
  }
  button.disabled = phase === "RUNNING";
  button.textContent = phase === "RUNNING" ? "Saving…" : "Save editable .aistudio";
}

async function saveThroughAndroidRuntime(
  runtime: NonNullable<Window["AIStudioRuntime"]>,
  session: StudioMovieSession,
  button: HTMLButtonElement,
): Promise<void> {
  setSaveUi(button, "RUNNING", "Packing Timeline and media manifest into .aistudio…");
  try {
    const bytes = await exportMovieSessionPackage(session);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const filename = `${safeFileStem(session.project.name)}.aistudio`;
    const saved = await runtime.saveBlob(filename, "application/zip", new Blob([copy.buffer], { type: "application/zip" }));
    setSaveUi(
      button,
      "SUCCESS",
      `Editable .aistudio saved to Android · ${saved.bytesWritten} bytes · SHA-256 ${saved.sha256.slice(0, 12)}… · ${session.timeline.tracks.length} tracks · ${Object.keys(session.assets).length} media assets`,
    );
  } catch (error) {
    setSaveUi(
      button,
      "ERROR",
      error instanceof Error ? error.message : ".aistudio Android save failed.",
    );
  }
}

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-save-aistudio-button]")
    : null;
  const runtime = window.AIStudioRuntime;
  if (target === null || runtime === undefined || target.disabled) return;

  const projectId = currentProjectId();
  const session = projectId === null ? null : movieSessionForProjectId(projectId);
  if (session === null) return;

  // The browser save handler uses a blob: download URL. Android WebView does not
  // own that destination, so intercept only inside the validated Runtime and
  // route the same package bytes through the existing MediaStore bridge.
  event.preventDefault();
  event.stopImmediatePropagation();
  void saveThroughAndroidRuntime(runtime, session, target);
}, true);
