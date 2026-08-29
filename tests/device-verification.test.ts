import { describe, expect, it } from "vitest";
import {
  analyzeDeviceVerificationReport,
  parseDeviceVerificationReport,
  summarizeDeviceChecks,
  validateDeviceVerificationReport,
  type DeviceBuildIdentity,
  type DeviceCheckResult,
  type DeviceVerificationReport,
} from "../apps/studio-web/src/device-check";

const TEST_BUILD: DeviceBuildIdentity = {
  repository: "tigpetryan-rgb/AI-Animation-Studio",
  commit: "1111111111111111111111111111111111111111",
  sourceDate: "2026-08-29T11:00:00.000Z",
};

const OTHER_BUILD: DeviceBuildIdentity = {
  ...TEST_BUILD,
  commit: "2222222222222222222222222222222222222222",
};

function check(
  id: string,
  required: boolean,
  status: DeviceCheckResult["status"],
): DeviceCheckResult {
  return {
    id,
    label: id,
    required,
    status,
    detail: status,
    durationMs: 1,
  };
}

function report(
  overrides: Partial<DeviceVerificationReport> = {},
  statuses: Partial<Record<string, DeviceCheckResult["status"]>> = {},
): DeviceVerificationReport {
  const checks: DeviceCheckResult[] = [
    check("secure-context", true, statuses["secure-context"] ?? "PASS"),
    check("service-worker", true, statuses["service-worker"] ?? "PASS"),
    check("opfs", true, statuses.opfs ?? "PASS"),
    check("indexeddb", true, statuses.indexeddb ?? "PASS"),
    check("wasm", true, statuses.wasm ?? "PASS"),
    check("webgpu", false, statuses.webgpu ?? "PASS"),
    check("webcodecs", false, statuses.webcodecs ?? "PASS"),
  ];

  return {
    schemaVersion: 2,
    build: TEST_BUILD,
    capturedAt: "2026-08-29T11:00:00.000Z",
    userAgent: "M23 test browser",
    summary: summarizeDeviceChecks(checks),
    checks,
    note: "test report",
    ...overrides,
  };
}

describe("device verification summary", () => {
  it("is READY when every check passes", () => {
    expect(summarizeDeviceChecks([
      check("secure-context", true, "PASS"),
      check("opfs", true, "PASS"),
      check("webgpu", false, "PASS"),
    ])).toBe("READY");
  });

  it("is DEGRADED when only optional capabilities are unavailable", () => {
    expect(summarizeDeviceChecks([
      check("secure-context", true, "PASS"),
      check("opfs", true, "PASS"),
      check("webgpu", false, "UNAVAILABLE"),
    ])).toBe("DEGRADED");
  });

  it("is FAILED when a required runtime check is not PASS", () => {
    expect(summarizeDeviceChecks([
      check("secure-context", true, "PASS"),
      check("opfs", true, "FAIL"),
      check("webgpu", false, "PASS"),
    ])).toBe("FAILED");
  });
});

describe("device report intake validation", () => {
  it("accepts a canonical schema-v2 READY report", () => {
    const result = validateDeviceVerificationReport(report(), TEST_BUILD);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.summary).toBe("READY");
      expect(result.report.build).toEqual(TEST_BUILD);
    }
  });

  it("accepts optional degradation and classifies FALLBACK", () => {
    const result = validateDeviceVerificationReport(report({}, { webgpu: "UNAVAILABLE" }), TEST_BUILD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.report.summary).toBe("DEGRADED");
    expect(analyzeDeviceVerificationReport(result.report)).toMatchObject({
      mode: "FALLBACK",
      requiredPassed: 5,
      requiredTotal: 5,
      optionalPassed: 1,
      optionalTotal: 2,
      degradedOptional: ["webgpu"],
    });
  });

  it("classifies a required failure as BLOCKED", () => {
    const candidate = report({}, { opfs: "FAIL" });
    expect(candidate.summary).toBe("FAILED");
    expect(analyzeDeviceVerificationReport(candidate)).toMatchObject({
      mode: "BLOCKED",
      requiredPassed: 4,
      failedRequired: ["opfs"],
    });
  });

  it("rejects malformed JSON and unsupported schema versions", () => {
    expect(parseDeviceVerificationReport("{").ok).toBe(false);
    const wrongSchema = { ...report(), schemaVersion: 1 };
    const validation = validateDeviceVerificationReport(wrongSchema);
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.issues).toContain("schemaVersion must equal 2.");
  });

  it("rejects an invalid build SHA", () => {
    const candidate = report();
    const validation = validateDeviceVerificationReport({
      ...candidate,
      build: { ...candidate.build, commit: "not-a-sha" },
    });
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.issues).toContain("build.commit must be a 40-character lowercase hexadecimal SHA.");
    }
  });

  it("rejects evidence produced by a different Studio build", () => {
    const validation = validateDeviceVerificationReport(report(), OTHER_BUILD);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.issues.some((issue) => issue.includes("does not match running Studio build"))).toBe(true);
    }
  });

  it("rejects a missing canonical required check", () => {
    const candidate = report();
    const missingOpfs = { ...candidate, checks: candidate.checks.filter((item) => item.id !== "opfs") };
    const validation = validateDeviceVerificationReport(missingOpfs);
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.issues).toContain("Missing required canonical check: opfs.");
  });

  it("rejects duplicate check ids", () => {
    const candidate = report();
    const validation = validateDeviceVerificationReport({
      ...candidate,
      checks: [...candidate.checks, candidate.checks[0]],
    });
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.issues.some((issue) => issue.includes("Duplicate check id"))).toBe(true);
  });

  it("rejects a summary that disagrees with check evidence", () => {
    const candidate = report({}, { webgpu: "UNAVAILABLE" });
    const validation = validateDeviceVerificationReport({ ...candidate, summary: "READY" });
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.issues.some((issue) => issue.includes("summary does not match checks"))).toBe(true);
  });
});
