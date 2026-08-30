import { describe, expect, it } from "vitest";
import {
  STUDIO_STREAMING_STORAGE_HEADROOM_BYTES,
  evaluateStudioStreamingStorageBudget,
} from "./studio-export-storage";

describe("Studio streaming export storage budget", () => {
  it("requires output size plus explicit disk safety headroom", () => {
    const estimated = 500 * 1024 * 1024;
    const budget = evaluateStudioStreamingStorageBudget(
      estimated,
      10 * 1024 * 1024 * 1024,
      2 * 1024 * 1024 * 1024,
    );

    expect(budget.sufficient).toBe(true);
    expect(budget.requiredBytes).toBeGreaterThan(estimated + STUDIO_STREAMING_STORAGE_HEADROOM_BYTES);
    expect(budget.availableBytes).toBe(8 * 1024 * 1024 * 1024);
    expect(budget.message).toContain("Disk preflight ready");
  });

  it("blocks before encode when the origin quota cannot hold the planned movie", () => {
    const budget = evaluateStudioStreamingStorageBudget(
      2 * 1024 * 1024 * 1024,
      3 * 1024 * 1024 * 1024,
      1.5 * 1024 * 1024 * 1024,
    );

    expect(budget.sufficient).toBe(false);
    expect(budget.availableBytes).toBe(1.5 * 1024 * 1024 * 1024);
    expect(budget.message).toContain("Not enough browser storage");
  });

  it("allows export when the browser cannot report quota while keeping the requirement visible", () => {
    const budget = evaluateStudioStreamingStorageBudget(300 * 1024 * 1024);

    expect(budget.sufficient).toBe(true);
    expect(budget.availableBytes).toBeNull();
    expect(budget.message).toContain("quota is unknown");
  });
});
