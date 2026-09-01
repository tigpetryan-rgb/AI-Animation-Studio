import { describe, expect, it } from "vitest";
import type { DeviceBuildIdentity } from "../apps/studio-web/src/device-check";
import {
  createStudioRuntimeCertificationEvidence,
  validateStudioRuntimeCertificationEvidence,
} from "../apps/studio-web/src/studio-runtime-evidence";
import type {
  StudioRuntimeInfo,
  StudioRuntimeMp4Inspection,
  StudioRuntimeNativeSaveResult,
} from "../apps/studio-web/src/studio-runtime-bridge";

const BUILD: DeviceBuildIdentity = {
  repository: "tigpetryan-rgb/AI-Animation-Studio",
  commit: "6f03887d9eec95f92b1d36c57d9ff3090ed9d346",
  sourceDate: "2026-08-30T13:08:07.000Z",
};

function runtimeInfo(overrides: Partial<StudioRuntimeInfo> = {}): StudioRuntimeInfo {
  return {
    schemaVersion: 1,
    platform: "android",
    manufacturer: "Xiaomi",
    brand: "POCO",
    model: "2311DRK48G",
    device: "duchamp",
    product: "duchamp_global",
    board: "duchamp",
    hardware: "mt6989",
    buildId: "BP2A.250805.005",
    buildFingerprint: "POCO/duchamp_global/duchamp:16/BP2A.250805.005/test:user/release-keys",
    androidRelease: "16",
    androidSdkInt: 36,
    androidIncremental: "OS3.0.0",
    securityPatch: "2026-08-01",
    supportedAbis: ["arm64-v8a", "armeabi-v7a"],
    emulated: false,
    physicalDeviceCandidate: true,
    studioRepository: BUILD.repository,
    studioCommitSha: BUILD.commit,
    studioSourceDate: BUILD.sourceDate,
    exactStudioBuildBound: true,
    runtimePackage: "com.aianimationstudio.runtime",
    runtimeVersion: "0.1.0-ci",
    runtimeVersionCode: 1,
    webViewPackage: "com.google.android.webview",
    webViewVersion: "140.0.7339.0",
    mediaCodecs: [],
    ...overrides,
  };
}

const NATIVE_SAVE: StudioRuntimeNativeSaveResult = {
  uri: "content://media/external/downloads/42",
  bytesWritten: 123456,
  sha256: "a".repeat(64),
};

function inspection(overrides: Partial<StudioRuntimeMp4Inspection> = {}): StudioRuntimeMp4Inspection {
  return {
    videoTrackPresent: true,
    audioTrackPresent: true,
    durationMs: 3000,
    width: 1920,
    height: 1080,
    firstVideoFrameDecoded: true,
    deterministicPlaybackVerified: true,
    note: "Native decoder reached EOS for video and audio with monotonic timestamps.",
    ...overrides,
  };
}

function report(
  runtimeOverrides: Partial<StudioRuntimeInfo> = {},
  inspectionOverrides: Partial<StudioRuntimeMp4Inspection> = {},
  physicalHardwareConfirmed = true,
) {
  return createStudioRuntimeCertificationEvidence(
    runtimeInfo(runtimeOverrides),
    NATIVE_SAVE,
    inspection(inspectionOverrides),
    "local-demo-project",
    physicalHardwareConfirmed,
    "2026-08-30T13:30:00.000Z",
    "Android Runtime Test UA",
  );
}

describe("M55 Android Runtime certification evidence", () => {
  it("accepts exact-build physical runtime evidence with a passing native decoder gate", () => {
    const result = validateStudioRuntimeCertificationEvidence(report(), BUILD);
    expect(result.ok).toBe(true);
  });

  it("rejects evidence without explicit observed-physical-hardware confirmation", () => {
    const result = validateStudioRuntimeCertificationEvidence(report({}, {}, false), BUILD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes("physicalHardwareConfirmed"))).toBe(true);
    }
  });

  it("rejects emulator runtime evidence even when a user confirmation is supplied", () => {
    const result = validateStudioRuntimeCertificationEvidence(
      report({ emulated: true, physicalDeviceCandidate: false }),
      BUILD,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes("physical-device evidence candidate"))).toBe(true);
    }
  });

  it("rejects an export whose native deterministic decoder gate did not pass", () => {
    const result = validateStudioRuntimeCertificationEvidence(
      report({}, { deterministicPlaybackVerified: false }),
      BUILD,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes("deterministicPlaybackVerified"))).toBe(true);
    }
  });

  it("rejects runtime evidence bound to a different Studio commit", () => {
    const result = validateStudioRuntimeCertificationEvidence(
      report({ studioCommitSha: "1".repeat(40) }),
      BUILD,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes("does not match running Studio build"))).toBe(true);
    }
  });
});
