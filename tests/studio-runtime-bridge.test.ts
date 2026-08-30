import { describe, expect, it } from "vitest";
import type { DeviceBuildIdentity } from "../apps/studio-web/src/device-check";
import {
  isStudioRuntimePhysicalEvidenceCandidate,
  parseStudioRuntimeInfo,
  validateStudioRuntimeInfo,
  type StudioRuntimeInfo,
} from "../apps/studio-web/src/studio-runtime-bridge";

const BUILD: DeviceBuildIdentity = {
  repository: "tigpetryan-rgb/AI-Animation-Studio",
  commit: "b4512df1f51c97f0a807787e6357b9210eb23a32",
  sourceDate: "2026-08-30T12:00:13.000Z",
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
    runtimeVersion: "0.1.0-dev",
    runtimeVersionCode: 1,
    webViewPackage: "com.google.android.webview",
    webViewVersion: "140.0.7339.0",
    mediaCodecs: [
      {
        name: "c2.mtk.avc.encoder",
        mimeType: "video/avc",
        encoder: true,
        hardwareAccelerated: true,
        softwareOnly: false,
        vendor: true,
        maxSupportedInstances: 16,
      },
    ],
    ...overrides,
  };
}

describe("M55 Studio Runtime identity", () => {
  it("accepts an exact-build Android runtime identity as a physical-evidence candidate", () => {
    const result = validateStudioRuntimeInfo(runtimeInfo(), BUILD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isStudioRuntimePhysicalEvidenceCandidate(result.info)).toBe(true);
  });

  it("keeps emulator runtime identity valid but ineligible for physical evidence", () => {
    const result = validateStudioRuntimeInfo(runtimeInfo({ emulated: true, physicalDeviceCandidate: false }), BUILD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isStudioRuntimePhysicalEvidenceCandidate(result.info)).toBe(false);
  });

  it("rejects a runtime built for another Studio commit", () => {
    const result = validateStudioRuntimeInfo(
      runtimeInfo({ studioCommitSha: "1111111111111111111111111111111111111111" }),
      BUILD,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes("does not match running Studio build"))).toBe(true);
    }
  });

  it("rejects a runtime whose exact-build flag contradicts its non-development SHA", () => {
    const result = validateStudioRuntimeInfo(runtimeInfo({ exactStudioBuildBound: false }), BUILD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes("exactStudioBuildBound"))).toBe(true);
    }
  });

  it("rejects source-date drift between the Runtime and bundled Studio", () => {
    const result = validateStudioRuntimeInfo(runtimeInfo({ studioSourceDate: "2026-08-30T12:00:14.000Z" }), BUILD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes("source date"))).toBe(true);
    }
  });

  it("fails closed on malformed native JSON", () => {
    const result = parseStudioRuntimeInfo("not-json", BUILD);
    expect(result.ok).toBe(false);
  });
});
