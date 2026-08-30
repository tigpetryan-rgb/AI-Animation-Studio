import type { DeviceBuildIdentity } from "./device-check";

export type PhysicalDeviceExportDisposition = "EXPORTED" | "UNSUPPORTED" | "FAILED";
export type PhysicalDeviceEvidenceMode = "FULL_EXPORT" | "SAFE_FALLBACK" | "FAILED";

export interface PhysicalDeviceDescriptor {
  readonly platform: string;
  readonly model: string;
  readonly osVersion: string;
  readonly browser: string;
  readonly browserVersion: string;
  readonly emulated: false;
}

export interface PhysicalDeviceSaveEvidence {
  readonly openedProject: boolean;
  readonly timelineEdited: boolean;
  readonly packageSaved: boolean;
  readonly packageReopened: boolean;
  readonly editPreserved: boolean;
}

export interface PhysicalDevicePlaybackEvidence {
  readonly metadataLoaded: boolean;
  readonly playbackProgressed: boolean;
  readonly videoTrackPresent: boolean;
  readonly audioTrackPresent: boolean;
}

export interface PhysicalDeviceExportEvidence {
  readonly disposition: PhysicalDeviceExportDisposition;
  readonly exportControlDisabled: boolean;
  readonly reason: string;
  readonly outputBytes: number;
  readonly outputSha256: string | null;
  readonly playback: PhysicalDevicePlaybackEvidence;
}

export interface PhysicalDeviceExportReport {
  readonly schemaVersion: 1;
  readonly build: DeviceBuildIdentity;
  readonly capturedAt: string;
  readonly userAgent: string;
  readonly device: PhysicalDeviceDescriptor;
  readonly projectId: string;
  readonly save: PhysicalDeviceSaveEvidence;
  readonly export: PhysicalDeviceExportEvidence;
}

export type PhysicalDeviceExportValidation =
  | { readonly ok: true; readonly report: PhysicalDeviceExportReport }
  | { readonly ok: false; readonly issues: readonly string[] };

const STUDIO_REPOSITORY = "tigpetryan-rgb/AI-Animation-Studio";
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DISPOSITIONS = new Set<PhysicalDeviceExportDisposition>(["EXPORTED", "UNSUPPORTED", "FAILED"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readBoolean(record: Record<string, unknown>, key: string, path: string, issues: string[]): boolean | null {
  const value = record[key];
  if (typeof value !== "boolean") {
    issues.push(`${path}.${key} must be boolean.`);
    return null;
  }
  return value;
}

export function classifyPhysicalDeviceExportEvidence(
  report: PhysicalDeviceExportReport,
): PhysicalDeviceEvidenceMode {
  const savePassed =
    report.save.openedProject
    && report.save.timelineEdited
    && report.save.packageSaved
    && report.save.packageReopened
    && report.save.editPreserved;

  if (!savePassed) return "FAILED";
  if (report.export.disposition === "EXPORTED") return "FULL_EXPORT";
  if (report.export.disposition === "UNSUPPORTED" && report.export.exportControlDisabled) {
    return "SAFE_FALLBACK";
  }
  return "FAILED";
}

export function validatePhysicalDeviceExportEvidence(
  input: unknown,
  expectedBuild?: DeviceBuildIdentity,
): PhysicalDeviceExportValidation {
  const issues: string[] = [];
  if (!isRecord(input)) return { ok: false, issues: ["Report root must be a JSON object."] };

  if (input.schemaVersion !== 1) issues.push("schemaVersion must equal 1.");

  let build: DeviceBuildIdentity | null = null;
  if (!isRecord(input.build)) {
    issues.push("build must be an object.");
  } else {
    const repository = input.build.repository;
    const commit = input.build.commit;
    const sourceDate = input.build.sourceDate;
    if (repository !== STUDIO_REPOSITORY) issues.push(`build.repository must equal ${STUDIO_REPOSITORY}.`);
    if (typeof commit !== "string" || !SHA40.test(commit)) {
      issues.push("build.commit must be a 40-character lowercase hexadecimal SHA.");
    }
    if (!isNonEmptyString(sourceDate) || Number.isNaN(Date.parse(sourceDate))) {
      issues.push("build.sourceDate must be a valid date/time string.");
    }
    if (
      repository === STUDIO_REPOSITORY
      && typeof commit === "string"
      && SHA40.test(commit)
      && isNonEmptyString(sourceDate)
      && !Number.isNaN(Date.parse(sourceDate))
    ) {
      build = { repository, commit, sourceDate };
    }
  }

  if (build && expectedBuild) {
    if (build.repository !== expectedBuild.repository) {
      issues.push(`Report repository ${build.repository} does not match running Studio repository ${expectedBuild.repository}.`);
    }
    if (build.commit !== expectedBuild.commit) {
      issues.push(`Report build commit ${build.commit} does not match running Studio build ${expectedBuild.commit}.`);
    }
  }

  if (!isNonEmptyString(input.capturedAt) || Number.isNaN(Date.parse(input.capturedAt))) {
    issues.push("capturedAt must be a valid date/time string.");
  }
  if (!isNonEmptyString(input.userAgent)) issues.push("userAgent must be a non-empty string.");
  if (!isNonEmptyString(input.projectId)) issues.push("projectId must be a non-empty string.");

  let device: PhysicalDeviceDescriptor | null = null;
  if (!isRecord(input.device)) {
    issues.push("device must be an object.");
  } else {
    const platform = input.device.platform;
    const model = input.device.model;
    const osVersion = input.device.osVersion;
    const browser = input.device.browser;
    const browserVersion = input.device.browserVersion;
    const emulated = input.device.emulated;
    if (!isNonEmptyString(platform)) issues.push("device.platform must be a non-empty string.");
    if (!isNonEmptyString(model)) issues.push("device.model must be a non-empty string.");
    if (!isNonEmptyString(osVersion)) issues.push("device.osVersion must be a non-empty string.");
    if (!isNonEmptyString(browser)) issues.push("device.browser must be a non-empty string.");
    if (!isNonEmptyString(browserVersion)) issues.push("device.browserVersion must be a non-empty string.");
    if (emulated !== false) issues.push("device.emulated must equal false for physical-device evidence.");
    if (
      isNonEmptyString(platform)
      && isNonEmptyString(model)
      && isNonEmptyString(osVersion)
      && isNonEmptyString(browser)
      && isNonEmptyString(browserVersion)
      && emulated === false
    ) {
      device = { platform, model, osVersion, browser, browserVersion, emulated: false };
    }
  }

  let save: PhysicalDeviceSaveEvidence | null = null;
  if (!isRecord(input.save)) {
    issues.push("save must be an object.");
  } else {
    const openedProject = readBoolean(input.save, "openedProject", "save", issues);
    const timelineEdited = readBoolean(input.save, "timelineEdited", "save", issues);
    const packageSaved = readBoolean(input.save, "packageSaved", "save", issues);
    const packageReopened = readBoolean(input.save, "packageReopened", "save", issues);
    const editPreserved = readBoolean(input.save, "editPreserved", "save", issues);
    if (
      openedProject !== null
      && timelineEdited !== null
      && packageSaved !== null
      && packageReopened !== null
      && editPreserved !== null
    ) {
      save = { openedProject, timelineEdited, packageSaved, packageReopened, editPreserved };
    }
  }

  let exportEvidence: PhysicalDeviceExportEvidence | null = null;
  if (!isRecord(input.export)) {
    issues.push("export must be an object.");
  } else {
    const disposition = input.export.disposition;
    const exportControlDisabled = input.export.exportControlDisabled;
    const reason = input.export.reason;
    const outputBytes = input.export.outputBytes;
    const outputSha256 = input.export.outputSha256;

    if (!DISPOSITIONS.has(disposition as PhysicalDeviceExportDisposition)) {
      issues.push("export.disposition must be EXPORTED, UNSUPPORTED or FAILED.");
    }
    if (typeof exportControlDisabled !== "boolean") issues.push("export.exportControlDisabled must be boolean.");
    if (typeof reason !== "string") issues.push("export.reason must be a string.");
    if (typeof outputBytes !== "number" || !Number.isSafeInteger(outputBytes) || outputBytes < 0) {
      issues.push("export.outputBytes must be a non-negative safe integer.");
    }
    if (outputSha256 !== null && (typeof outputSha256 !== "string" || !SHA256.test(outputSha256))) {
      issues.push("export.outputSha256 must be null or a 64-character lowercase hexadecimal SHA-256.");
    }

    let playback: PhysicalDevicePlaybackEvidence | null = null;
    if (!isRecord(input.export.playback)) {
      issues.push("export.playback must be an object.");
    } else {
      const metadataLoaded = readBoolean(input.export.playback, "metadataLoaded", "export.playback", issues);
      const playbackProgressed = readBoolean(input.export.playback, "playbackProgressed", "export.playback", issues);
      const videoTrackPresent = readBoolean(input.export.playback, "videoTrackPresent", "export.playback", issues);
      const audioTrackPresent = readBoolean(input.export.playback, "audioTrackPresent", "export.playback", issues);
      if (
        metadataLoaded !== null
        && playbackProgressed !== null
        && videoTrackPresent !== null
        && audioTrackPresent !== null
      ) {
        playback = { metadataLoaded, playbackProgressed, videoTrackPresent, audioTrackPresent };
      }
    }

    if (
      DISPOSITIONS.has(disposition as PhysicalDeviceExportDisposition)
      && typeof exportControlDisabled === "boolean"
      && typeof reason === "string"
      && typeof outputBytes === "number"
      && Number.isSafeInteger(outputBytes)
      && outputBytes >= 0
      && (outputSha256 === null || (typeof outputSha256 === "string" && SHA256.test(outputSha256)))
      && playback
    ) {
      exportEvidence = {
        disposition: disposition as PhysicalDeviceExportDisposition,
        exportControlDisabled,
        reason,
        outputBytes,
        outputSha256,
        playback,
      };

      if (exportEvidence.disposition === "EXPORTED") {
        if (exportEvidence.exportControlDisabled) issues.push("EXPORTED evidence cannot have exportControlDisabled=true.");
        if (exportEvidence.outputBytes <= 0) issues.push("EXPORTED evidence must record outputBytes > 0.");
        if (exportEvidence.outputSha256 === null) issues.push("EXPORTED evidence must include outputSha256.");
        if (!exportEvidence.playback.metadataLoaded) issues.push("EXPORTED evidence must load playback metadata.");
        if (!exportEvidence.playback.playbackProgressed) issues.push("EXPORTED evidence must prove playback progress.");
        if (!exportEvidence.playback.videoTrackPresent) issues.push("EXPORTED evidence must prove a video track.");
        if (!exportEvidence.playback.audioTrackPresent) issues.push("EXPORTED evidence must prove an audio track.");
      }
      if (exportEvidence.disposition === "UNSUPPORTED") {
        if (!exportEvidence.exportControlDisabled) issues.push("UNSUPPORTED evidence must have exportControlDisabled=true.");
        if (!isNonEmptyString(exportEvidence.reason)) issues.push("UNSUPPORTED evidence must include a reason.");
        if (exportEvidence.outputBytes !== 0) issues.push("UNSUPPORTED evidence must record outputBytes=0.");
        if (exportEvidence.outputSha256 !== null) issues.push("UNSUPPORTED evidence must not include outputSha256.");
      }
    }
  }

  if (issues.length > 0 || !build || !device || !save || !exportEvidence) return { ok: false, issues };

  return {
    ok: true,
    report: {
      schemaVersion: 1,
      build,
      capturedAt: input.capturedAt as string,
      userAgent: input.userAgent as string,
      device,
      projectId: input.projectId as string,
      save,
      export: exportEvidence,
    },
  };
}

export function parsePhysicalDeviceExportEvidence(
  json: string,
  expectedBuild?: DeviceBuildIdentity,
): PhysicalDeviceExportValidation {
  try {
    return validatePhysicalDeviceExportEvidence(JSON.parse(json) as unknown, expectedBuild);
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON."],
    };
  }
}
