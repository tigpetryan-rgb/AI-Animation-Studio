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
let preparedAssetSignature = "";
let previewSequence = 0;
let lastPreviewKey = "";
let syncQueued = false;
let projectMessage = "Open, relink, or save an editable .aistudio project.";
let relinkedAssetId = "";

function setText(node: HTMLElement, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

function currentProjectId(): string | null {
  const assets = document.querySelector<HTMLElement>(".assets-panel");
  const value = assets?.querySelector<HTMLElement>("p.muted")?.textContent?.trim() ?? "";
  return value.length === 0 || value === "No project open" ? null : value;
}

function currentSession(): StudioMovieSession | null {
  return movieSessionForProjectId(currentProjectId());
}

function timeFromSeconds(seconds: number): RationalTime {
  return rationalTime(BigInt(Math.round(seconds * 1_000_000)), 1_000_000n);
}

function safeDuration(session: StudioMovieSession): number {
  return Math.max(1 / session.exportProfile.frameRate, movieDurationSeconds(session));
}

function assetSignature(session: StudioMovieSession): string {
  return Object.values(session.assets)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((asset) => `${asset.id}|${asset.uri}|${asset.mimeType}|${asset.encoding}`)
    .join("\n");
}

function timelineSignature(session: StudioMovieSession): string {
  const clips = session.timeline.tracks.flatMap((track) => track.clips.map((clip) => [
    track.id,
    clip.id,
    clip.assetId,
    clip.timelineStart.value.toString(),
    clip.timelineStart.timescale.toString(),
    clip.sourceIn.value.toString(),
    clip.sourceIn.timescale.toString(),
    clip.duration.value.toString(),
    clip.duration.timescale.toString(),
  ].join("|")));
  return `${session.project.projectId}::${session.timeline.id}::${selectedClipId ?? ""}::${clips.join(";")}`;
}

function findSelectedClip(session: StudioMovieSession): { track: TimelineTrack; clip: TimelineClip } | null {
  if (selectedClipId === null) return null;
  for (const track of session.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === selectedClipId);
    if (clip !== undefined) return { track, clip };
  }
  return null;
}

function replaceClip(session: StudioMovieSession, trackId: string, clip: TimelineClip): void {
  const tracks = session.timeline.tracks.map((track) => track.id === trackId
    ? Object.freeze({
      ...track,
      clips: Object.freeze(track.clips.map((candidate) => candidate.id === clip.id ? Object.freeze(clip) : candidate)),
    })
    : track);
  const timeline: Timeline = Object.freeze({ ...session.timeline, tracks: Object.freeze(tracks) });
  registerMovieSession(Object.freeze({ ...session, timeline }));
}

function updateSelectedClip(operation: "trim-in" | "trim-out" | "slip-back" | "slip-forward"): void {
  const session = currentSession();
  const selected = session === null ? null : findSelectedClip(session);
  if (session === null || selected === null) return;

  const frameSeconds = 1 / session.exportProfile.frameRate;
  const start = rationalSeconds(selected.clip.timelineStart);
  const source = rationalSeconds(selected.clip.sourceIn);
  const end = rationalSeconds(clipEnd(selected.clip));

  try {
    let next: TimelineClip;
    if (operation === "trim-in") next = trimClipStart(selected.clip, timeFromSeconds(start + frameSeconds));
    else if (operation === "trim-out") next = trimClipEnd(selected.clip, timeFromSeconds(end - frameSeconds));
    else if (operation === "slip-back") next = slipClip(selected.clip, timeFromSeconds(Math.max(0, source - frameSeconds)));
    else next = slipClip(selected.clip, timeFromSeconds(source + frameSeconds));

    replaceClip(session, selected.track.id, next);
    projectMessage = `Edited ${next.id}: ${operation}.`;
  } catch (error) {
    projectMessage = error instanceof Error ? error.message : "Timeline edit failed.";
  }
  scheduleSync();
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Relink file did not produce a data URL."));
    }, { once: true });
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
  relinkedAssetId = assetId;
  projectMessage = `Relinked ${asset.label} to ${file.name}. The replacement is embedded in the next .aistudio save.`;
}

async function openMoviePackage(file: File): Promise<void> {
  const session = await importMovieSessionPackage(new Uint8Array(await file.arrayBuffer()));
  registerMovieSession(session);
  selectedClipId = null;
  playheadSeconds = 0;
  relinkedAssetId = "";
  projectMessage = `Reopened ${file.name}: ${session.timeline.tracks.length} tracks and ${Object.keys(session.assets).length} media assets restored.`;

  if (currentProjectId() !== session.project.projectId && session.project.projectId === "local-demo-project") {
    const openDemo = [...document.querySelectorAll<HTMLButtonElement>(".assets-panel button")]
      .find((button) => button.textContent?.includes("Open local demo"));
    openDemo?.click();
  }
}

function createProjectControls(assetsPanel: HTMLElement): HTMLElement {
  const panel = document.createElement("section");
  panel.dataset.projectFileControls = "true";
  panel.className = "project-file-controls";

  const heading = document.createElement("h3");
  heading.textContent = "Project file";

  const openInput = document.createElement("input");
  openInput.type = "file";
  openInput.accept = ".aistudio,application/zip";
  openInput.hidden = true;
  openInput.dataset.openAistudioInput = "true";

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.dataset.openAistudioButton = "true";
  openButton.textContent = "Open .aistudio";
  openButton.addEventListener("click", () => openInput.click());
  openInput.addEventListener("change", () => {
    const file = openInput.files?.[0];
    if (file !== undefined) {
      void openMoviePackage(file).then(scheduleSync).catch((error: unknown) => {
        projectMessage = error instanceof Error ? error.message : ".aistudio open failed.";
        scheduleSync();
      });
    }
    openInput.value = "";
  });

  const assetSelect = document.createElement("select");
  assetSelect.dataset.relinkAssetSelect = "true";

  const relinkInput = document.createElement("input");
  relinkInput.type = "file";
  relinkInput.hidden = true;
  relinkInput.dataset.relinkMediaInput = "true";

  const relinkButton = document.createElement("button");
  relinkButton.type = "button";
  relinkButton.dataset.relinkMediaButton = "true";
  relinkButton.textContent = "Relink selected media";
  relinkButton.addEventListener("click", () => relinkInput.click());

  assetSelect.addEventListener("change", () => {
    const asset = currentSession()?.assets[assetSelect.value];
    relinkInput.accept = asset === undefined ? "" : `${asset.mediaType}/*`;
  });

  relinkInput.addEventListener("change", () => {
    const session = currentSession();
    const file = relinkInput.files?.[0];
    if (session !== null && file !== undefined && assetSelect.value.length > 0) {
      void relinkAsset(session, assetSelect.value, file).then(scheduleSync).catch((error: unknown) => {
        projectMessage = error instanceof Error ? error.message : "Media relink failed.";
        scheduleSync();
      });
    }
    relinkInput.value = "";
  });

  const status = document.createElement("p");
  status.className = "muted";
  status.dataset.projectFileStatus = "true";
  status.setAttribute("role", "status");

  panel.append(heading, openButton, openInput, assetSelect, relinkButton, relinkInput, status);
  assetsPanel.append(panel);
  return panel;
}

function ensureProjectControls(assetsPanel: HTMLElement, session: StudioMovieSession | null): void {
  const panel = assetsPanel.querySelector<HTMLElement>("[data-project-file-controls]") ?? createProjectControls(assetsPanel);
  const select = panel.querySelector<HTMLSelectElement>("[data-relink-asset-select]");
  const relinkButton = panel.querySelector<HTMLButtonElement>("[data-relink-media-button]");
  const relinkInput = panel.querySelector<HTMLInputElement>("[data-relink-media-input]");
  const status = panel.querySelector<HTMLElement>("[data-project-file-status]");
  if (select === null || relinkButton === null || relinkInput === null || status === null) return;

  const signature = session === null
    ? "none"
    : Object.values(session.assets).sort((a, b) => a.id.localeCompare(b.id)).map((asset) => `${asset.id}|${asset.label}|${asset.mediaType}`).join(";");
  if (panel.dataset.assetListSignature !== signature) {
    const previous = select.value;
    select.replaceChildren();
    if (session !== null) {
      for (const asset of Object.values(session.assets).sort((a, b) => a.label.localeCompare(b.label))) {
        const option = document.createElement("option");
        option.value = asset.id;
        option.textContent = `${asset.label} · ${asset.mediaType}`;
        select.append(option);
      }
      if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    }
    panel.dataset.assetListSignature = signature;
  }

  const selectedAsset = session?.assets[select.value];
  relinkInput.accept = selectedAsset === undefined ? "" : `${selectedAsset.mediaType}/*`;
  select.disabled = session === null;
  relinkButton.disabled = session === null || selectedAsset === undefined;
  status.dataset.relinkedAssetId = relinkedAssetId;
  setText(status, projectMessage);
}

function ensurePreviewStage(session: StudioMovieSession): { canvas: HTMLCanvasElement; status: HTMLElement } | null {
  const stage = document.querySelector<HTMLElement>(".stage-placeholder");
  if (stage === null) return null;
  let canvas = stage.querySelector<HTMLCanvasElement>("[data-timeline-preview-canvas]");
  let status = stage.querySelector<HTMLElement>("[data-timeline-preview-status]");
  if (canvas === null || status === null) {
    stage.replaceChildren();
    stage.classList.add("timeline-preview-stage");
    canvas = document.createElement("canvas");
    canvas.className = "timeline-preview-canvas";
    canvas.dataset.timelinePreviewCanvas = "true";
    status = document.createElement("span");
    status.className = "timeline-preview-status";
    status.dataset.timelinePreviewStatus = "true";
    stage.append(canvas, status);
  }
  if (canvas.width !== session.exportProfile.width) canvas.width = session.exportProfile.width;
  if (canvas.height !== session.exportProfile.height) canvas.height = session.exportProfile.height;
  return { canvas, status };
}

async function renderPreview(session: StudioMovieSession): Promise<void> {
  const stage = ensurePreviewStage(session);
  if (stage === null) return;
  const timelineKey = timelineSignature(session);
  const assetsKey = assetSignature(session);
  const key = `${timelineKey}::${assetsKey}::${playheadSeconds.toFixed(6)}`;
  if (key === lastPreviewKey && stage.status.dataset.previewPhase === "READY") return;

  const sequence = ++previewSequence;
  try {
    let media = preparedMedia;
    if (media === undefined || preparedAssetSignature !== assetsKey) {
      setText(stage.status, "Decoding Timeline preview media…");
      const loaded = await prepareMovieMedia(session);
      if (sequence !== previewSequence) {
        loaded.close();
        return;
      }
      preparedMedia?.close();
      preparedMedia = loaded;
      preparedAssetSignature = assetsKey;
      media = loaded;
    }

    const duration = safeDuration(session);
    const maxTime = Math.max(0, duration - 1 / session.exportProfile.frameRate);
    playheadSeconds = Math.min(Math.max(0, playheadSeconds), maxTime);
    const sample = sampleMovieTimeline(session, timeFromSeconds(playheadSeconds));
    const context = stage.canvas.getContext("2d");
    if (context === null) throw new Error("Preview 2D canvas context is unavailable.");
    await drawMovieTimelineFrame(context, session, media, sample, playheadSeconds, duration);
    if (sequence !== previewSequence) return;

    const picture = sample.video?.asset.label ?? "gap";
    const audio = sample.audio?.asset.label ?? "silence";
    setText(stage.status, `Timeline preview · ${playheadSeconds.toFixed(2)}s · ${picture} · ${audio}`);
    stage.status.dataset.previewPhase = "READY";
    lastPreviewKey = key;
  } catch (error) {
    if (sequence !== previewSequence) return;
    setText(stage.status, error instanceof Error ? error.message : "Timeline preview failed.");
    stage.status.dataset.previewPhase = "ERROR";
  }
}

function createTrackRow(session: StudioMovieSession, track: TimelineTrack, duration: number): HTMLElement {
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
    button.textContent = session.assets[clip.assetId]?.label ?? clip.assetId;
    button.title = `${clip.id} · ${rationalSeconds(clip.duration).toFixed(2)}s`;
    button.style.left = `${Math.max(0, rationalSeconds(clip.timelineStart) / duration) * 100}%`;
    button.style.width = `${Math.max(1.5, rationalSeconds(clip.duration) / duration * 100)}%`;
    button.addEventListener("click", () => {
      selectedClipId = clip.id;
      playheadSeconds = rationalSeconds(clip.timelineStart);
      scheduleSync();
    });
    rail.append(button);
  }
  row.append(label, rail);
  return row;
}

function ensureTimelineEditor(footer: HTMLElement, session: StudioMovieSession): void {
  const signature = timelineSignature(session);
  if (footer.dataset.timelineEditorSignature === signature && footer.querySelector("[data-timeline-editor]") !== null) return;

  const duration = safeDuration(session);
  footer.replaceChildren();
  footer.classList.add("timeline-editor-host");
  footer.dataset.timelineEditorSignature = signature;

  const editor = document.createElement("div");
  editor.className = "timeline-editor";
  editor.dataset.timelineEditor = "true";

  const toolbar = document.createElement("div");
  toolbar.className = "timeline-toolbar";
  const timecode = document.createElement("span");
  timecode.className = "timecode";
  timecode.dataset.timelineTimecode = "true";
  setText(timecode, `${playheadSeconds.toFixed(2)}s / ${duration.toFixed(2)}s`);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(Math.max(0, duration - 1 / session.exportProfile.frameRate));
  slider.step = String(1 / session.exportProfile.frameRate);
  slider.value = String(Math.min(playheadSeconds, Number(slider.max)));
  slider.dataset.timelinePlayhead = "true";
  slider.addEventListener("input", () => {
    playheadSeconds = Number(slider.value);
    setText(timecode, `${playheadSeconds.toFixed(2)}s / ${duration.toFixed(2)}s`);
    void renderPreview(session);
  });
  toolbar.append(timecode, slider);

  const tracks = document.createElement("div");
  tracks.className = "timeline-tracks";
  for (const track of session.timeline.tracks.filter((candidate) => candidate.kind === "video" || candidate.kind === "audio")) {
    tracks.append(createTrackRow(session, track, duration));
  }

  const editbar = document.createElement("div");
  editbar.className = "timeline-editbar";
  const selected = findSelectedClip(session);
  const selectedText = document.createElement("span");
  selectedText.dataset.timelineSelection = "true";
  setText(selectedText, selected === null
    ? "Select a clip to edit"
    : `${selected.clip.id} · source ${rationalSeconds(selected.clip.sourceIn).toFixed(2)}s · duration ${rationalSeconds(selected.clip.duration).toFixed(2)}s`);
  editbar.append(selectedText);

  const actions: readonly [string, "trim-in" | "trim-out" | "slip-back" | "slip-forward"][] = [
    ["Trim in +1f", "trim-in"],
    ["Trim out -1f", "trim-out"],
    ["Source -1f", "slip-back"],
    ["Source +1f", "slip-forward"],
  ];
  for (const [label, action] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.timelineEditAction = action;
    button.disabled = selected === null;
    button.addEventListener("click", () => updateSelectedClip(action));
    editbar.append(button);
  }

  editor.append(toolbar, tracks, editbar);
  footer.append(editor);
}

function syncEditor(): void {
  syncQueued = false;
  const session = currentSession();
  const assetsPanel = document.querySelector<HTMLElement>(".assets-panel");
  if (assetsPanel !== null) ensureProjectControls(assetsPanel, session);
  if (session === null) return;

  const footer = document.querySelector<HTMLElement>("footer.timeline");
  if (footer !== null) ensureTimelineEditor(footer, session);
  void renderPreview(session);
}

function scheduleSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(syncEditor);
}

window.addEventListener("aistudio:movie-session-change", () => {
  lastPreviewKey = "";
  scheduleSync();
});

export function installStudioTimelineEditor(): void {
  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleSync();
}

installStudioTimelineEditor();
