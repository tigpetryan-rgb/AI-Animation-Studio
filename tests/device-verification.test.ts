import { describe, expect, it } from "vitest";
import {
  analyzeDeviceVerificationReport,
  parseDeviceVerificationReport,
  summarizeDeviceChecks,
  validateDeviceVerificationReport,
  type DeviceCheckResult,
  type DeviceVerificationReport,
} from "../apps/studio-web/src/device-check";

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
    schemaVersion: 1,
    capturedAt: "2026-08-29T11:00:00.000Z",
    userAgent: "M22 test browser",
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
  it("accepts a canonical schema-v1 READY report", () => {
    const result = validateDeviceVerificationReport(report());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.summary).toBe("READY");
  });

  it("accepts optional degradation and classifies FALLBACK", () => {
    const result = validateDeviceVerificationReport(report({}, { webgpu: "UNAVAILABLE" }));
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
    const wrongSchema = { ...report(), schemaVersion: 2 };
    const validation = validateDeviceVerificationReport(wrongSchema);
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.issues).toContain("schemaVersion must equal 1.");
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
