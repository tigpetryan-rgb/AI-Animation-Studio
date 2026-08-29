import { describe, expect, it } from "vitest";
import { MemoryStorageAdapter, createAtomicSavePlan, type BinaryStorageAdapter } from "@aistudio/browser-runtime";
import {
  JOURNAL_ROOT,
  decodeJournalRecord,
  encodeJournalRecord,
  fingerprintBytes,
  journalPath,
  recoverProjectJournals,
  saveJournaled,
  type JournalRecord,
} from "./index.js";

function beginRecord(
  transactionId: string,
  targetPath: string,
  revision: number,
  data: Uint8Array,
): JournalRecord {
  const plan = createAtomicSavePlan(targetPath, revision);
  return {
    version: 1,
    transactionId,
    targetPath: plan.targetPath,
    tempPath: plan.tempPath,
    revision,
    payloadFingerprint: fingerprintBytes(data),
    phase: "BEGIN",
  };
}

class NonAtomicMemoryAdapter implements BinaryStorageAdapter {
  readonly kind = "MEMORY" as const;
  readonly persistent = false;
  readonly atomicReplace = false;
  private readonly inner = new MemoryStorageAdapter();

  read(path: string): Promise<Uint8Array | undefined> { return this.inner.read(path); }
  write(path: string, data: Uint8Array): Promise<void> { return this.inner.write(path, data); }
  remove(path: string): Promise<void> { return this.inner.remove(path); }
  list(prefix: string): Promise<readonly string[]> { return this.inner.list(prefix); }
  replace(fromPath: string, toPath: string): Promise<void> { return this.inner.replace(fromPath, toPath); }
}

describe("project storage journal", () => {
  it("round-trips a deterministic journal record including Unicode paths", () => {
    const data = new Uint8Array([1, 2, 3]);
    const record = beginRecord("tx-1", "/ֆիլմ/project.aistudio", 4, data);
    expect(decodeJournalRecord(encodeJournalRecord(record))).toEqual(record);
    expect(fingerprintBytes(data)).toBe(fingerprintBytes(new Uint8Array([1, 2, 3])));
    expect(fingerprintBytes(data)).not.toBe(fingerprintBytes(new Uint8Array([1, 2, 4])));
  });

  it("rejects unsafe transaction identifiers and invalid journal JSON", () => {
    expect(() => journalPath("../escape")).toThrow("transactionId must use only");
    expect(decodeJournalRecord(new TextEncoder().encode("not-json"))).toBeUndefined();
  });

  it("commits a journaled save and leaves no journal or temp files", async () => {
    const storage = new MemoryStorageAdapter();
    const data = new Uint8Array([7, 8, 9]);
    const result = await saveJournaled(storage, {
      transactionId: "tx-save",
      targetPath: "/projects/film.aistudio",
      revision: 2,
      data,
    });

    expect(result.committed).toBe(true);
    expect([...(await storage.read("/projects/film.aistudio"))!]).toEqual([7, 8, 9]);
    expect(await storage.list(JOURNAL_ROOT)).toEqual([]);
    expect(await storage.list("/projects/film.aistudio.tmp")).toEqual([]);
  });

  it("replays a verified temp payload after a crash before replace", async () => {
    const storage = new MemoryStorageAdapter();
    const data = new Uint8Array([4, 5, 6]);
    const record = beginRecord("tx-replay", "/project.aistudio", 3, data);
    await storage.write(journalPath(record.transactionId), encodeJournalRecord(record));
    await storage.write(record.tempPath, data);

    const result = await recoverProjectJournals(storage);
    expect(result.diagnostics).toEqual([]);
    expect(result.actions).toEqual([{ transactionId: "tx-replay", action: "REPLAYED_TEMP", targetPath: "/project.aistudio" }]);
    expect([...(await storage.read("/project.aistudio"))!]).toEqual([4, 5, 6]);
    expect(await storage.list(JOURNAL_ROOT)).toEqual([]);
  });

  it("finalizes an already replaced target after a crash before journal cleanup", async () => {
    const storage = new MemoryStorageAdapter();
    const data = new Uint8Array([10, 11]);
    const record = beginRecord("tx-finalize", "/project.aistudio", 5, data);
    await storage.write(journalPath(record.transactionId), encodeJournalRecord(record));
    await storage.write(record.targetPath, data);
    await storage.write(record.tempPath, new Uint8Array([99]));

    const result = await recoverProjectJournals(storage);
    expect(result.actions[0]?.action).toBe("FINALIZED_TARGET");
    expect(await storage.read(record.tempPath)).toBeUndefined();
    expect(await storage.list(JOURNAL_ROOT)).toEqual([]);
  });

  it("preserves evidence and reports manual recovery when payloads do not match", async () => {
    const storage = new MemoryStorageAdapter();
    const record = beginRecord("tx-bad", "/project.aistudio", 1, new Uint8Array([1]));
    const path = journalPath(record.transactionId);
    await storage.write(path, encodeJournalRecord(record));
    await storage.write(record.tempPath, new Uint8Array([2]));

    const result = await recoverProjectJournals(storage);
    expect(result.actions).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe("JOURNAL_PAYLOAD_MISSING_OR_CORRUPT");
    expect(await storage.read(path)).toBeDefined();
    expect(await storage.read(record.tempPath)).toBeDefined();
  });

  it("does not replay a temp payload on a non-atomic backend", async () => {
    const storage = new NonAtomicMemoryAdapter();
    const data = new Uint8Array([3]);
    const record = beginRecord("tx-non-atomic", "/project.aistudio", 1, data);
    await storage.write(journalPath(record.transactionId), encodeJournalRecord(record));
    await storage.write(record.tempPath, data);

    const result = await recoverProjectJournals(storage);
    expect(result.actions).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe("JOURNAL_REPLACE_NOT_ATOMIC");
    expect(await storage.read(record.targetPath)).toBeUndefined();
  });

  it("reports corrupt journals without deleting them", async () => {
    const storage = new MemoryStorageAdapter();
    const path = `${JOURNAL_ROOT}/corrupt.json`;
    await storage.write(path, new TextEncoder().encode("{"));
    const result = await recoverProjectJournals(storage);
    expect(result.diagnostics[0]?.code).toBe("JOURNAL_CORRUPT");
    expect(await storage.read(path)).toBeDefined();
  });
});
