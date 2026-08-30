import type { PhysicalDeviceSaveEvidence } from "./physical-device-export-evidence";

export interface PhysicalDeviceWorkflowObservation {
  readonly projectId: string | null;
  readonly timelineSignature: string | null;
  readonly projectStatus: string;
  readonly exportStatus: string;
}

export interface PhysicalDeviceWorkflowCaptureState extends PhysicalDeviceSaveEvidence {
  readonly savedProjectId: string | null;
  readonly savedTimelineSignature: string | null;
  readonly lastProjectId: string | null;
  readonly lastTimelineSignature: string | null;
  readonly lastProjectStatus: string;
  readonly lastExportStatus: string;
}

export interface Mp4TrackPresence {
  readonly videoTrackPresent: boolean;
  readonly audioTrackPresent: boolean;
}

interface Mp4Box {
  readonly type: string;
  readonly payloadStart: number;
  readonly end: number;
}

export function createPhysicalDeviceWorkflowCaptureState(): PhysicalDeviceWorkflowCaptureState {
  return {
    openedProject: false,
    timelineEdited: false,
    packageSaved: false,
    packageReopened: false,
    editPreserved: false,
    savedProjectId: null,
    savedTimelineSignature: null,
    lastProjectId: null,
    lastTimelineSignature: null,
    lastProjectStatus: "",
    lastExportStatus: "",
  };
}

export function physicalDeviceSaveEvidence(
  state: PhysicalDeviceWorkflowCaptureState,
): PhysicalDeviceSaveEvidence {
  return {
    openedProject: state.openedProject,
    timelineEdited: state.timelineEdited,
    packageSaved: state.packageSaved,
    packageReopened: state.packageReopened,
    editPreserved: state.editPreserved,
  };
}

export function advancePhysicalDeviceWorkflowCapture(
  state: PhysicalDeviceWorkflowCaptureState,
  observation: PhysicalDeviceWorkflowObservation,
): PhysicalDeviceWorkflowCaptureState {
  let next: PhysicalDeviceWorkflowCaptureState = { ...state };
  const hasSession = observation.projectId !== null && observation.timelineSignature !== null;
  if (hasSession) next = { ...next, openedProject: true };

  const projectSwitched = state.lastProjectId !== null
    && observation.projectId !== null
    && observation.projectId !== state.lastProjectId;
  if (projectSwitched) {
    next = {
      ...next,
      timelineEdited: false,
      packageSaved: false,
      packageReopened: false,
      editPreserved: false,
      savedProjectId: null,
      savedTimelineSignature: null,
    };
  }

  const sameProject = state.lastProjectId !== null
    && observation.projectId === state.lastProjectId;
  const signatureChanged = sameProject
    && state.lastTimelineSignature !== null
    && observation.timelineSignature !== null
    && observation.timelineSignature !== state.lastTimelineSignature;
  const projectStatusChanged = observation.projectStatus !== state.lastProjectStatus;
  const exportStatusChanged = observation.exportStatus !== state.lastExportStatus;

  const reopenedNow = hasSession
    && observation.projectStatus.startsWith("Reopened ")
    && (projectStatusChanged || signatureChanged);
  const editedNow = hasSession
    && !reopenedNow
    && observation.projectStatus.startsWith("Edited ")
    && (projectStatusChanged || signatureChanged);

  if (editedNow) {
    next = {
      ...next,
      timelineEdited: true,
      packageSaved: false,
      packageReopened: false,
      editPreserved: false,
      savedProjectId: null,
      savedTimelineSignature: null,
    };
  }

  const savedNow = hasSession
    && !reopenedNow
    && next.timelineEdited
    && observation.exportStatus.startsWith("Editable .aistudio saved")
    && exportStatusChanged;
  if (savedNow) {
    next = {
      ...next,
      packageSaved: true,
      packageReopened: false,
      editPreserved: false,
      savedProjectId: observation.projectId,
      savedTimelineSignature: observation.timelineSignature,
    };
  }

  if (reopenedNow) {
    const editPreserved = next.packageSaved
      && next.savedProjectId !== null
      && next.savedProjectId === observation.projectId
      && next.savedTimelineSignature !== null
      && next.savedTimelineSignature === observation.timelineSignature;
    next = {
      ...next,
      packageReopened: true,
      editPreserved,
    };
  }

  return {
    ...next,
    lastProjectId: observation.projectId,
    lastTimelineSignature: observation.timelineSignature,
    lastProjectStatus: observation.projectStatus,
    lastExportStatus: observation.exportStatus,
  };
}

function readFourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
}

function readBox(bytes: Uint8Array, view: DataView, offset: number, limit: number): Mp4Box | null {
  if (offset + 8 > limit) return null;
  const size32 = view.getUint32(offset, false);
  const type = readFourCc(bytes, offset + 4);
  let headerSize = 8;
  let boxSize = size32;

  if (size32 === 1) {
    if (offset + 16 > limit) return null;
    const high = view.getUint32(offset + 8, false);
    const low = view.getUint32(offset + 12, false);
    boxSize = high * 2 ** 32 + low;
    headerSize = 16;
    if (!Number.isSafeInteger(boxSize)) return null;
  } else if (size32 === 0) {
    boxSize = limit - offset;
  }

  if (boxSize < headerSize || offset + boxSize > limit) return null;
  return {
    type,
    payloadStart: offset + headerSize,
    end: offset + boxSize,
  };
}

function boxesInRange(bytes: Uint8Array, view: DataView, start: number, end: number): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const box = readBox(bytes, view, offset, end);
    if (box === null) break;
    boxes.push(box);
    if (box.end <= offset) break;
    offset = box.end;
  }
  return boxes;
}

function handlerTypeForTrack(bytes: Uint8Array, view: DataView, track: Mp4Box): string | null {
  const mdia = boxesInRange(bytes, view, track.payloadStart, track.end).find((box) => box.type === "mdia");
  if (mdia === undefined) return null;
  const hdlr = boxesInRange(bytes, view, mdia.payloadStart, mdia.end).find((box) => box.type === "hdlr");
  if (hdlr === undefined || hdlr.payloadStart + 12 > hdlr.end) return null;
  return readFourCc(bytes, hdlr.payloadStart + 8);
}

export function inspectMp4TrackPresence(bytes: Uint8Array): Mp4TrackPresence {
  if (bytes.byteLength < 8) return { videoTrackPresent: false, audioTrackPresent: false };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = boxesInRange(bytes, view, 0, bytes.byteLength).find((box) => box.type === "moov");
  if (moov === undefined) return { videoTrackPresent: false, audioTrackPresent: false };

  let videoTrackPresent = false;
  let audioTrackPresent = false;
  for (const track of boxesInRange(bytes, view, moov.payloadStart, moov.end).filter((box) => box.type === "trak")) {
    const handler = handlerTypeForTrack(bytes, view, track);
    if (handler === "vide") videoTrackPresent = true;
    if (handler === "soun") audioTrackPresent = true;
  }
  return { videoTrackPresent, audioTrackPresent };
}
