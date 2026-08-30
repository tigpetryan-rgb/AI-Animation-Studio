import { describe, expect, it } from "vitest";
import type { DeviceBuildIdentity } from "../apps/studio-web/src/device-check";
import {
  classifyPhysicalDeviceExportEvidence,
  parsePhysicalDeviceExportEvidence,
  validatePhysicalDeviceExportEvidence,
  type PhysicalDeviceExportReport,
} from "../apps/studio-web/src/physical-device-export-evidence";

const BUILD: DeviceBuildIdentity = {
  repository: "tigpetryan-rgb/AI-Animation-Studio",
  commit: "23710db77268b601fd48b205488f4ca2eda3176e",
  sourceDate: "2026-08-30T10:02:04.000Z",
};

function fullExportReport(overrides: Partial<PhysicalDeviceExportReport> = {}): PhysicalDeviceExportReport {
  return {
    schemaVersion: 1,
    build: BUILD,
    capturedAt: "2026-08-30T10:30:00.000Z",
    userAgent: "Physical Chrome device",
    device: {
      platform: "Android",
      model: "Pixel 9",
      osVersion: "16",
      browser: "Chrome",
      browserVersion: "140",
      emulated: false,
    },
    projectId: "local-demo-project",
    save: {
      openedProject: true,
      timelineEdited: true,
      packageSaved: true,
      packageReopened: true,
      editPreserved: true,
    },
    export: {
      disposition: "EXPORTED",
      exportControlDisabled: false,
      reason: "",
      outputBytes: 1024,
      outputSha256: "a".repeat(64),
      playback: {
        metadataLoaded: true,
        playbackProgressed: true,
        videoTrackPresent: true,
        audioTrackPresent: true,
      },
    },
    ...overrides,
  };
}

function unsupportedReport(): PhysicalDeviceExportReport {
  return {
    ...fullExportReport(),
    userAgent: "Physical Safari device",
    device: {
      platform: "iOS",
      model: "iPhone 17",
      osVersion: "20",
      browser: "Safari",
      browserVersion: "20",
      emulated: false,
    },
    export: {
      disposition: "UNSUPPORTED",
      exportControlDisabled: true,
      reason: "Native WebCodecs H.264 export is unsupported on this device.",
      outputBytes: 0,
      outputSha256: null,
      playback: {
        metadataLoaded: false,
        playbackProgressed: false,
        videoTrackPresent: false,
        audioTrackPresent: false,
      },
    },
  };
}

describe("physical-device production evidence", () => {
  it("accepts exact-build physical evidence for a real playable export", () => {
    const result = validatePhysicalDeviceExportEvidence(fullExportReport(), BUILD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(classifyPhysicalDeviceExportEvidence(result.report)).toBe("FULL_EXPORT");
  });

  it("accepts fail-closed unsupported export evidence when editable save/reopen still passes", () => {
    const result = validatePhysicalDeviceExportEvidence(unsupportedReport(), BUILD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(classifyPhysicalDeviceExportEvidence(result.report)).toBe("SAFE_FALLBACK");
  });

  it("rejects Playwright or emulator evidence as physical-device proof", () => {
    const candidate = fullExportReport() as unknown as Record<string, unknown>;
    candidate.device = { ...fullExportReport().device, emulated: true };
    const result = validatePhysicalDeviceExportEvidence(candidate, BUILD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContain("device.emulated must equal false for physical-device evidence.");
    }
  });

  it("rejects evidence from another Studio build", () => {
    const result = validatePhysicalDeviceExportEvidence(fullExportReport(), {
      ...BUILD,
      commit: "1111111111111111111111111111111111111111",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes("does not match running Studio build"))).toBe(true);
    }
  });

  it("rejects an exported file without a SHA-256 identity", () => {
    const candidate = fullExportReport();
    const result = validatePhysicalDeviceExportEvidence({
      ...candidate,
      export: { ...candidate.export, outputSha256: null },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContain("EXPORTED evidence must include outputSha256.");
  });

  it("rejects unsupported evidence that produced output bytes instead of failing closed", () => {
    const candidate = unsupportedReport();
    const result = validatePhysicalDeviceExportEvidence({
      ...candidate,
      export: { ...candidate.export, outputBytes: 12 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContain("UNSUPPORTED evidence must record outputBytes=0.");
  });

  it("classifies a broken editable-save flow as failed even when export evidence is otherwise valid", () => {
    const candidate = fullExportReport({
      save: { ...fullExportReport().save, editPreserved: false },
    });
    expect(classifyPhysicalDeviceExportEvidence(candidate)).toBe("FAILED");
  });

  it("rejects malformed JSON", () => {
    const result = parsePhysicalDeviceExportEvidence("{", BUILD);
    expect(result.ok).toBe(false);
  });
});
