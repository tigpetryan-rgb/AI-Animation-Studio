import { describe, expect, it } from "vitest";
import {
  nextPersistenceSlot,
  serializePersistenceStressReport,
  slotFilename,
  type PersistenceStressReport,
} from "../apps/studio-web/src/persistence-stress";

describe("persistence stress utilities", () => {
  it("alternates dual persistence slots deterministically", () => {
    expect(nextPersistenceSlot()).toBe("A");
    expect(nextPersistenceSlot("A")).toBe("B");
    expect(nextPersistenceSlot("B")).toBe("A");
    expect(slotFilename("A")).toBe("project-a.json");
    expect(slotFilename("B")).toBe("project-b.json");
  });

  it("serializes persistence evidence with exact build provenance", () => {
    const report: PersistenceStressReport = {
      schemaVersion: 1,
      build: {
        repository: "tigpetryan-rgb/AI-Animation-Studio",
        commit: "2222222222222222222222222222222222222222",
        sourceDate: "2026-08-29T13:00:00.000Z",
      },
      capturedAt: "2026-08-29T13:01:00.000Z",
      userAgent: "persistence-test",
      summary: "VERIFIED",
      online: false,
      activeSlot: "B",
      saveRevision: 6,
      recoverySource: "ACTIVE",
      project: {
        projectId: "project_m26_persistence_stress",
        name: "M26 Persistence Stress 6",
        stateRevision: 0,
      },
      checks: [{ id: "canonical-deserialize", status: "PASS", detail: "validated" }],
      note: "test report",
    };

    const serialized = serializePersistenceStressReport(report);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(JSON.parse(serialized)).toEqual(report);
  });
});
