import { describe, expect, it } from "vitest";
import {
  advancePhysicalDeviceWorkflowCapture,
  createPhysicalDeviceWorkflowCaptureState,
  inspectMp4TrackPresence,
  physicalDeviceSaveEvidence,
  type PhysicalDeviceWorkflowObservation,
} from "../apps/studio-web/src/physical-device-evidence-capture";

function observation(overrides: Partial<PhysicalDeviceWorkflowObservation> = {}): PhysicalDeviceWorkflowObservation {
  return {
    projectId: "local-demo-project",
    timelineSignature: "timeline-a",
    projectStatus: "Open, relink, or save an editable .aistudio project.",
    exportStatus: "Ready to export.",
    ...overrides,
  };
}

function ascii(value: string): Uint8Array {
  return Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
}

function box(type: string, ...payloadParts: Uint8Array[]): Uint8Array {
  const payloadBytes = payloadParts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(8 + payloadBytes);
  new DataView(bytes.buffer).setUint32(0, bytes.byteLength, false);
  bytes.set(ascii(type), 4);
  let offset = 8;
  for (const part of payloadParts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function track(handlerType: "vide" | "soun"): Uint8Array {
  const handlerPayload = new Uint8Array(12);
  handlerPayload.set(ascii(handlerType), 8);
  return box("trak", box("mdia", box("hdlr", handlerPayload)));
}

function mp4(...handlers: Array<"vide" | "soun">): Uint8Array {
  return box("moov", ...handlers.map(track));
}

describe("physical-device workflow capture", () => {
  it("accepts only an edit -> save -> reopen cycle with the same saved timeline", () => {
    let state = createPhysicalDeviceWorkflowCaptureState();
    state = advancePhysicalDeviceWorkflowCapture(state, observation());
    state = advancePhysicalDeviceWorkflowCapture(state, observation({
      timelineSignature: "timeline-b",
      projectStatus: "Edited opening-shot: trim-in.",
    }));
    state = advancePhysicalDeviceWorkflowCapture(state, observation({
      timelineSignature: "timeline-b",
      projectStatus: "Edited opening-shot: trim-in.",
      exportStatus: "Editable .aistudio saved · 2 tracks · 4 media assets",
    }));
    state = advancePhysicalDeviceWorkflowCapture(state, observation({
      timelineSignature: "timeline-b",
      projectStatus: "Reopened local-demo.aistudio: 2 tracks and 4 media assets restored.",
      exportStatus: "Editable .aistudio saved · 2 tracks · 4 media assets",
    }));

    expect(physicalDeviceSaveEvidence(state)).toEqual({
      openedProject: true,
      timelineEdited: true,
      packageSaved: true,
      packageReopened: true,
      editPreserved: true,
    });
  });

  it("does not relatch a stale saved status on reopen and falsely certify a mismatched timeline", () => {
    let state = createPhysicalDeviceWorkflowCaptureState();
    state = advancePhysicalDeviceWorkflowCapture(state, observation());
    state = advancePhysicalDeviceWorkflowCapture(state, observation({
      timelineSignature: "timeline-b",
      projectStatus: "Edited opening-shot: trim-in.",
    }));
    state = advancePhysicalDeviceWorkflowCapture(state, observation({
      timelineSignature: "timeline-b",
      projectStatus: "Edited opening-shot: trim-in.",
      exportStatus: "Editable .aistudio saved · 2 tracks · 4 media assets",
    }));
    state = advancePhysicalDeviceWorkflowCapture(state, observation({
      timelineSignature: "timeline-a",
      projectStatus: "Reopened local-demo.aistudio: 2 tracks and 4 media assets restored.",
      exportStatus: "Editable .aistudio saved · 2 tracks · 4 media assets",
    }));

    expect(state.savedTimelineSignature).toBe("timeline-b");
    expect(state.packageReopened).toBe(true);
    expect(state.editPreserved).toBe(false);
  });

  it("invalidates an earlier passing cycle after a new timeline edit", () => {
    let state = createPhysicalDeviceWorkflowCaptureState();
    state = advancePhysicalDeviceWorkflowCapture(state, observation());
    state = advancePhysicalDeviceWorkflowCapture(state, observation({
      timelineSignature: "timeline-b",
      projectStatus: "Edited opening-shot: trim-in.",
    }));
    state = advancePhysicalDeviceWorkflowCapture(state, observation({
      timelineSignature: "timeline-b",
      projectStatus: "Edited opening-shot: trim-in.",
      exportStatus: "Editable .aistudio saved · 2 tracks · 4 media assets",
    }));
    state = advancePhysicalDeviceWorkflowCapture(state, observation({
      timelineSignature: "timeline-b",
      projectStatus: "Reopened local-demo.aistudio: 2 tracks and 4 media assets restored.",
      exportStatus: "Editable .aistudio saved · 2 tracks · 4 media assets",
    }));
    state = advancePhysicalDeviceWorkflowCapture(state, observation({
      timelineSignature: "timeline-c",
      projectStatus: "Edited opening-shot: slip-forward.",
      exportStatus: "Editable .aistudio saved · 2 tracks · 4 media assets",
    }));

    expect(state.timelineEdited).toBe(true);
    expect(state.packageSaved).toBe(false);
    expect(state.packageReopened).toBe(false);
    expect(state.editPreserved).toBe(false);
  });
});

describe("physical-device MP4 inspection", () => {
  it("finds video and audio tracks from ISO BMFF handler boxes without browser captureStream APIs", () => {
    expect(inspectMp4TrackPresence(mp4("vide", "soun"))).toEqual({
      videoTrackPresent: true,
      audioTrackPresent: true,
    });
  });

  it("fails closed when the MP4 declares only a video track", () => {
    expect(inspectMp4TrackPresence(mp4("vide"))).toEqual({
      videoTrackPresent: true,
      audioTrackPresent: false,
    });
  });

  it("fails closed on malformed bytes", () => {
    expect(inspectMp4TrackPresence(new Uint8Array([0, 0, 0, 4]))).toEqual({
      videoTrackPresent: false,
      audioTrackPresent: false,
    });
  });
});
