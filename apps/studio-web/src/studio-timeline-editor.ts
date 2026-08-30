import { rationalTime, type RationalTime } from "@aistudio/core-time";
import {
  clipEnd,
  slipClip,
  trimClipEnd,
  trimClipStart,
  type Timeline,
  type TimelineClip,
  type TimelineTrack,
} from "@aistudio/timeline-engine";
import { drawMovieTimelineFrame } from "./studio-frame-renderer";
import { prepareMovieMedia, type PreparedMovieMedia } from "./studio-media-assets";
import {
  movieDurationSeconds,
  movieSessionForProjectId,
  rationalSeconds,
  registerMovieSession,
  sampleMovieTimeline,
  type MovieTimelineAsset,
  type StudioMovieSession,
} from "./studio-movie-session";
import { importMovieSessionPackage } from "./studio-session-package";

let selectedClipId: string | null = null;
let playheadSeconds = 0;
let preparedMedia: PreparedMovieMedia | undefined;
let preparedSignature = "";
let previewRevision = 0;
let syncQueued = false;
let projectMessage = "Open or save an editable .aistudio project.";

function currentProjectId(): string | null {
  const assets = document.querySelector<HTMLElement>(".assets-panel");
  const value = assets?.querySelector<HTMLElement>("p.muted")?.textContent?.trim() ?? "";
  if (value.length === 0 || value === "No project open") return null;
  return value;
}

function currentSession(): StudioMovieSession | null {
  return movieSessionForProjectId(currentProjectId());
}

function timeFromSeconds(seconds: number): RationalTime {
  return rationalTime(BigInt(Math.round(seconds * 1_000_000)), 1_000_000n);
}

function assetSignature(session: StudioMovieSession): string {
  return Object.values(session.assets)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((asset) => `${asset.id}|${asset.uri}|${asset.mimeType}|${asset.encoding}`)
    .join("\n");
}

function safeDuration(session: StudioMovieSession): number {
  return Math.max(1 / session.exportProfile.frameRate, movieDurationSeconds(session));
}

function findSelectedClip(session: StudioMovieSession): { track: TimelineTrack; clip: TimelineClip } | null {
  if (selectedClipId === null) return null;
  for (const track of session.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === selectedClipId);
    if (clip !== undefined) return { track, clip };
  }
  return null;
}

function replaceClip(session: StudioMovieSession, trackId: string, clip: TimelineClip): StudioMovieSession {
  const tracks = session.timeline.tracks.map((track) => track.id === trackId
    ? Object.freeze({ ...track, clips: Object.freeze(track.clips.map((candidate) => candidate.id === clip.id ? Object.freeze(clip) : candidate)) })
    : track);
  const timeline: Timeline = Object.freeze({ ...session.timeline, tracks: Object.freeze(tracks) });
  return registerMovieSession(Object.freeze({ ...session, timeline }));
}

function updateSelectedClip(operation: "trim-in" | "trim-out" | "slip-back" | "slip-forward"): void {
  const session = currentSession();
  if (session === null) return;
  const selected = findSelectedClip(session);
  if (selected === null) return;
  const frameSeconds = 1 / session.exportProfile.frameRate;
  const frame = timeFromSeconds(frameSeconds);
  const startSeconds = rationalSeconds(selected.clip.timelineStart);
  const sourceSeconds = rationalSeconds(selected.clip.sourceIn);
  const endSeconds = rationalSeconds(clipEnd(selected.clip));
  let next: TimelineClip;

  try {
    if (operation === "trim-in") {
      next = trimClipStart(selected.clip, timeFromSeconds(startSeconds + frameSeconds));
    } else if (operation === "trim-out") {
      next = trimClipEnd(selected.clip, timeFromSeconds(endSeconds - frameSeconds));
    } else if (operation === "slip-back") {
      next = slipClip(selected.clip, timeFromSeconds(Math.max(0, sourceSeconds - rationalSeconds(frame))));
    } else {
      next = slipClip(selected.clip, timeFromSeconds(sourceSeconds + rationalSeconds(frame)));
    }
    replaceClip(session, selected.track.id, next);
    projectMessage = `Edited ${next.id}: ${operation}.`;
    syncEditor();
  } catch (error) {
    projectMessage = error instanceof Error ? error.message : "Timeline edit failed.";
    syncEditor();
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Relink file did not produce a data URL.")), { once: true });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Relink file read failed.")), { once: true });
    reader.readAsDataURL(file);
  });
}

function expectedMimeFamily(asset: MovieTimelineAsset): "image" | "video" | "audio" {
  return asset.mediaType;
}

async function relinkAsset(session: StudioMovieSession, assetId: string, file: File): Promise<void> {
  const asset = session.assets[assetId];
  if (asset === undefined) throw new Error(`Unknown media asset ${assetId}.`);
  const family = expectedMimeFamily(asset);
  if (!file.type.startsWith(`${family}/`)) {
    throw new Error(`${asset.label} expects ${family} media, not ${file.type || "an unknown file type"}.`);
  }
  const uri = await readAsDataUrl(file);
  const replacement = Object.freeze({ ...asset, uri, encoding: "identity" as const, mimeType: file.type });
  registerMovieSession(Object.freeze({
    ...session,
    assets: Object.freeze({ ...session.assets, [assetId]: replacement }),
  }));
  projectMessage = `Relinked ${asset.label} to ${file.name}; the media is now portable inside the next .aistudio save.`;
}

async function openMoviePackage(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const session = await importMovieSessionPackage(bytes);
  registerMovieSession(session);
  selectedClipId = null;
  playheadSeconds = 0;
  projectMessage = `Reopened ${file.name}: ${session.timeline.tracks.length} tracks and ${Object.keys(session.assets).length} media assets restored.`;

  const displayedProjectId = currentProjectId();
  if (displayedProjectId !== session.project.projectId) {
    const demoButton = [...document.querySelectorAll<HTMLButtonElement>(".assets-panel button")]
      .find((button) => button.textContent?.includes("Open local demo"));
    if (session.project.projectId === "local-demo-project" && demoButton !== undefined) demoButton.click();
  }
  syncEditor();
}

function ensureProjectControls(assetsPanel: HTMLElement, session: StudioMovieSession | null): void {
  let panel = assetsPanel.querySelector<HTMLElement>("[data-project-file-controls]");
  if (panel === null) {
    panel = document.createElement("section");
    panel.dataset.projectFileControls = "true";
    panel.className = "project-file-controls";

    const heading = document.createElement("h3");
    heading.textContent = "Project file";

    const openInput = document.createElement("input");
    openInput.type = "file";
    openInput.accept = ".aistudio,application/zip";
    openInput.hidden = true;
    openInput.dataset.openAistudioInput = "true";
    openInput.addEventListener("change", () => {
      const file = openInput.files?.[0];
      if (file !== undefined) void openMoviePackage(file).catch((error: unknown) => {
        projectMessage = error instanceof Error ? error.message : ".aistudio open failed.";
        syncEditor();
      });
      openInput.value = "";
    });

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.dataset.openAistudioButton = "true";
    openButton.textContent = "Open .aistudio";
    openButton.addEventListener("click", () => openInput.click());

    const assetSelect = document.createElement("select");
    assetSelect.dataset.relinkAssetSelect = "true";

    const relinkInput = document.createElement("input");
    relinkInput.type = "file";
    relinkInput.hidden = true;
    relinkInput.dataset.relinkMediaInput = "true";
    relinkInput.addEventListener("change", () => {
      const active = currentSession();
      const file = relinkInput.files?.[0];
      const selectedId = assetSelect.value;
      if (active !== null && file !== undefined && selectedId.length > 0) {
        void relinkAsset(active, selectedId, file).then(syncEditor).catch((error: unknown) => {
          projectMessage = error instanceof Error ? error.message : "Media relink failed.";
          syncEditor();
        });
      }
      relinkInput.value = "";
    });

    const relinkButton = document.createElement("button");
    relinkButton.type = "button";
    relinkButton.dataset.relinkMediaButton = "true";
    relinkButton.textContent = "Relink selected media";
    relinkButton.addEventListener("click", () => relinkInput.click());

    const status = document.createElement("p");
    status.className = "muted";
    status.dataset.projectFileStatus = "true";
    status.setAttribute("role", "status");

    panel.append(heading, openButton, openInput, assetSelect, relinkButton, relinkInput, status);
    assetsPanel.append(panel);
  }

  const select = panel.querySelector<HTMLSelectElement>("[data-relink-asset-select]");
  const relinkButton = panel.querySelector<HTMLButtonElement>("[data-relink-media-button]");
  const status = panel.querySelector<HTMLElement>("[data-project-file-status]");
  if (select === null || relinkButton === null || status === null) return;

  const previous = select.value;
  select.replaceChildren();
  if (session !== null) {
    for (const asset of Object.values(session.assets).sort((left, right) => left.label.localeCompare(right.label))) {
      const option = document.createElement("option");
      option.value = asset.id;
      option.textContent = `${asset.label} · ${asset.mediaType}`;
      select.append(option);
    }
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }
  select.disabled = session === null;
  relinkButton.disabled = session === null || select.options.length === 0;
  status.textContent = projectMessage;
}

function ensurePreviewStage(session: StudioMovieSession | null): { canvas: HTMLCanvasElement; status: HTMLElement } | null {
  const stage = document.querySelector<HTMLElement>(".stage-placeholder");
  if (stage === null) return null;
  let canvas = stage.querySelector<HTMLCanvasElement>("[data-timeline-preview-canvas]");
  let status = stage.querySelector<HTMLElement>("[data-timeline-preview-status]");
  if (canvas === null || status === null) {
    stage.replaceChildren();
    stage.classList.add("timeline-preview-stage");
    canvas = document.createElement("canvas");
    canvas.dataset.timelinePreviewCanvas = "true";
    canvas.className = "timeline-preview-canvas";
    status = document.createElement("span");
    status.dataset.timelinePreviewStatus = "true";
    status.className = "timeline-preview-status";
    stage.append(canvas, status);
  }
  if (session !== null) {
    canvas.width = session.exportProfile.width;
    canvas.height = session.exportProfile.height;
  }
  return { canvas, status };
}

async function ensurePreparedMedia(session: StudioMovieSession): Promise<PreparedMovieMedia> {
  const signature = assetSignature(session);
  if (preparedMedia !== undefined && signature === preparedSignature) return preparedMedia;
  const revision = ++previewRevision;
  preparedMedia?.close();
  preparedMedia = undefined;
  preparedSignature = "";
  const stage = ensurePreviewStage(session);
  if (stage !== null) stage.status.textContent = "Decoding preview media…";
  const media = await prepareMovieMedia(session);
  if (revision !== previewRevision) {
    media.close();
    throw new Error("Preview media load was superseded.");
  }
  preparedMedia = media;
  preparedSignature = signature;
  return media;
}

async function renderPreview(session: StudioMovieSession): Promise<void> {
  const stage = ensurePreviewStage(session);
  if (stage === null) return;
  const revision = ++previewRevision;
  try {
    let media: PreparedMovieMedia;
    const signature = assetSignature(session);
    if (preparedMedia !== undefined && preparedSignature === signature) {
      media = preparedMedia;
    } else {
      const loaded = await prepareMovieMedia(session);
      if (revision !== previewRevision) {
        loaded.close();
        return;
      }
      preparedMedia?.close();
      preparedMedia = loaded;
      preparedSignature = signature;
      media = loaded;
    }

    const duration = safeDuration(session);
    playheadSeconds = Math.min(Math.max(0, playheadSeconds), Math.max(0, duration - 1 / session.exportProfile.frameRate));
    const timelineTime = timeFromSeconds(playheadSeconds);
    const sample = sampleMovieTimeline(session, timelineTime);
    const context = stage.canvas.getContext("2d");
    if (context === null) throw new Error("Preview 2D canvas context is unavailable.");
    await drawMovieTimelineFrame(context, session, media, sample, playheadSeconds, duration);
    if (revision !== previewRevision) return;
    const picture = sample.video?.asset.label ?? "gap";
    const audio = sample.audio?.asset.label ?? "silence";
    stage.status.textContent = `Timeline preview · ${playheadSeconds.toFixed(2)}s · ${picture} · ${audio}`;
    stage.status.dataset.previewPhase = "READY";
  } catch (error) {
    if (revision !== previewRevision) return;
    stage.status.textContent = error instanceof Error ? error.message : "Timeline preview failed.";
    stage.status.dataset.previewPhase = "ERROR";
  }
}

function renderTrackRail(session: StudioMovieSession, track: TimelineTrack, duration: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "timeline-track-row";
  row.dataset.timelineTrackId = track.id;

  const label = document.createElement("span");
  label.className = "timeline-track-label";
  label.textContent = `${track.kind} · ${track.id}`;

  const rail = document.createElement("div");
  rail.className = "timeline-track-rail";
  for (const clip of track.clips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `timeline-clip${clip.id === selectedClipId ? " selected" : ""}`;
    button.dataset.timelineClipId = clip.id;
    button.title = `${clip.id} · ${rationalSeconds(clip.duration).toFixed(2)}s`;
    button.textContent = session.assets[clip.assetId]?.label ?? clip.assetId;
    button.style.left = `${Math.max(0, rationalSeconds(clip.timelineStart) / duration) * 100}%`;
    button.style.width = `${Math.max(1.5, rationalSeconds(clip.duration) / duration * 100)}%`;
    button.addEventListener("click", () => {
      selectedClipId = clip.id;
      playheadSeconds = rationalSeconds(clip.timelineStart);
      syncEditor();
    });
    rail.append(button);
  }
  row.append(label, rail);
  return row;
}

function ensureTimelineEditor(footer: HTMLElement, session: StudioMovieSession): void {
  const duration = safeDuration(session);
  footer.replaceChildren();
  footer.classList.add("timeline-editor-host");

  const editor = document.createElement("div");
  editor.className = "timeline-editor";
  editor.dataset.timelineEditor = "true";

  const toolbar = document.createElement("div");
  toolbar.className = "timeline-toolbar";
  const timecode = document.createElement("span");
  timecode.className = "timecode";
  timecode.dataset.timelineTimecode = "true";
  timecode.textContent = `${playheadSeconds.toFixed(2)}s / ${duration.toFixed(2)}s`;

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(Math.max(0, duration - 1 / session.exportProfile.frameRate));
  slider.step = String(1 / session.exportProfile.frameRate);
  slider.value = String(Math.min(playheadSeconds, Number(slider.max)));
  slider.dataset.timelinePlayhead = "true";
  slider.addEventListener("input", () => {
    playheadSeconds = Number(slider.value);
    timecode.textContent = `${playheadSeconds.toFixed(2)}s / ${duration.toFixed(2)}s`;
    void renderPreview(session);
  });
  toolbar.append(timecode, slider);

  const tracks = document.createElement("div");
  tracks.className = "timeline-tracks";
  for (const track of session.timeline.tracks.filter((candidate) => candidate.kind === "video" || candidate.kind === "audio")) {
    tracks.append(renderTrackRail(session, track, duration));
  }

  const editbar = document.createElement("div");
  editbar.className = "timeline-editbar";
  const selected = findSelectedClip(session);
  const selectedText = document.createElement("span");
  selectedText.dataset.timelineSelection = "true";
  selectedText.textContent = selected === null
    ? "Select a clip to edit"
    : `${selected.clip.id} · source ${rationalSeconds(selected.clip.sourceIn).toFixed(2)}s · duration ${rationalSeconds(selected.clip.duration).toFixed(2)}s`;
  editbar.append(selectedText);

  const actions: readonly [string, string, "trim-in" | "trim-out" | "slip-back" | "slip-forward"][] = [
    ["Trim in +1f", "trim-in", "trim-in"],
    ["Trim out -1f", "trim-out", "trim-out"],
    ["Source -1f", "slip-back", "slip-back"],
    ["Source +1f", "slip-forward", "slip-forward"],
  ];
  for (const [label, dataAction, operation] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.timelineEditAction = dataAction;
    button.disabled = selected === null;
    button.addEventListener("click", () => updateSelectedClip(operation));
    editbar.append(button);
  }

  editor.append(toolbar, tracks, editbar);
  footer.append(editor);
}

function syncEditor(): void {
  syncQueued = false;
  const session = currentSession();
  const assets = document.querySelector<HTMLElement>(".assets-panel");
  if (assets !== null) ensureProjectControls(assets, session);

  const footer = document.querySelector<HTMLElement>("footer.timeline");
  if (session === null) {
    preparedMedia?.close();
    preparedMedia = undefined;
    preparedSignature = "";
    return;
  }

  if (footer !== null) ensureTimelineEditor(footer, session);
  void renderPreview(session);
}

function scheduleSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(syncEditor);
}

window.addEventListener("aistudio:movie-session-change", scheduleSync);

export function installStudioTimelineEditor(): void {
  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleSync();
}

installStudioTimelineEditor();
