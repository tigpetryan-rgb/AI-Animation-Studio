import { describe, expect, it } from "vitest";
import {
  summarizeDeviceChecks,
  type DeviceCheckResult,
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
