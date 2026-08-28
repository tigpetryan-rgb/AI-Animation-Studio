import { describe, expect, it } from "vitest";
import {
  addTime,
  compareTime,
  deserializeTime,
  rationalTime,
  serializeTime,
  subtractTime,
  timeFromFrame,
} from "../packages/core-time/src/index.ts";

describe("core-time", () => {
  it("normalizes rational values exactly", () => {
    expect(rationalTime(100n, 24n)).toEqual({ value: 25n, timescale: 6n });
  });

  it("supports exact addition and subtraction", () => {
    const a = rationalTime(1n, 24n);
    const b = rationalTime(1n, 30n);

    expect(addTime(a, b)).toEqual({ value: 3n, timescale: 40n });
    expect(subtractTime(a, b)).toEqual({ value: 1n, timescale: 120n });
  });

  it("preserves fractional frame rates without floating point", () => {
    const frame100 = timeFromFrame(100n, 30000n, 1001n);
    expect(frame100).toEqual({ value: 1001n, timescale: 300n });
  });

  it("compares values without converting to Number", () => {
    expect(compareTime(rationalTime(1n, 2n), rationalTime(2n, 3n))).toBe(-1);
    expect(compareTime(rationalTime(3n, 4n), rationalTime(6n, 8n))).toBe(0);
  });

  it("serializes bigint-safe project data", () => {
    const original = rationalTime(1001n, 30000n);
    expect(deserializeTime(serializeTime(original))).toEqual(original);
  });

  it("rejects invalid time and fps denominators", () => {
    expect(() => rationalTime(1n, 0n)).toThrow(RangeError);
    expect(() => timeFromFrame(1n, 0n)).toThrow(RangeError);
  });
});
