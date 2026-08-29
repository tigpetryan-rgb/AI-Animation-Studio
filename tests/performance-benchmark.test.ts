import { describe, expect, it } from "vitest";
import {
  percentile,
  serializePerformanceBenchmarkReport,
  summarizePerformanceMeasurements,
  type PerformanceBenchmarkReport,
  type PerformanceMeasurement,
} from "../apps/studio-web/src/performance-benchmark";

function measurement(status: PerformanceMeasurement["status"]): PerformanceMeasurement {
  return {
    id: `m-${status.toLowerCase()}`,
    label: status,
    status,
    durationMs: 1,
    detail: "test",
    metrics: {},
  };
}

describe("performance benchmark math", () => {
  it("computes bounded nearest-rank percentiles", () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(20);
    expect(percentile([40, 10, 30, 20], 0.95)).toBe(40);
    expect(percentile([4, 2, 1, 3], -1)).toBe(1);
    expect(percentile([4, 2, 1, 3], 2)).toBe(4);
  });

  it("classifies reports without inventing performance thresholds", () => {
    expect(summarizePerformanceMeasurements([measurement("PASS"), measurement("PASS")])).toBe("COMPLETE");
    expect(summarizePerformanceMeasurements([measurement("PASS"), measurement("UNAVAILABLE")])).toBe("PARTIAL");
    expect(summarizePerformanceMeasurements([measurement("PASS"), measurement("FAIL")])).toBe("FAILED");
  });

  it("serializes a machine-readable report with provenance", () => {
    const report: PerformanceBenchmarkReport = {
      schemaVersion: 1,
      build: {
        repository: "tigpetryan-rgb/AI-Animation-Studio",
        commit: "1111111111111111111111111111111111111111",
        sourceDate: "2026-08-29T12:00:00.000Z",
      },
      capturedAt: "2026-08-29T12:01:00.000Z",
      userAgent: "benchmark-test",
      summary: "COMPLETE",
      measurements: [measurement("PASS")],
      note: "test report",
    };

    const serialized = serializePerformanceBenchmarkReport(report);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(JSON.parse(serialized)).toEqual(report);
  });
});
