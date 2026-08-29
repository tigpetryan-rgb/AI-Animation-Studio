import {
  createAtomicSavePlan,
  saveAtomically,
  type AtomicSaveResult,
  type BinaryStorageAdapter,
} from "@aistudio/browser-runtime";

export type JournalPhase = "BEGIN" | "COMMIT";

export interface JournalRecord {
  readonly version: 1;
  readonly transactionId: string;
  readonly targetPath: string;
  readonly tempPath: string;
  readonly revision: number;
  readonly payloadFingerprint: string;
  readonly phase: JournalPhase;
}

export interface JournaledSaveInput {
  readonly transactionId: string;
  readonly targetPath: string;
  readonly revision: number;
  readonly data: Uint8Array;
}

export type RecoveryAction = "FINALIZED_TARGET" | "REPLAYED_TEMP";

export type RecoveryDiagnosticCode =
  | "JOURNAL_CORRUPT"
  | "JOURNAL_PAYLOAD_MISSING_OR_CORRUPT"
  | "JOURNAL_REPLACE_NOT_ATOMIC"
  | "JOURNAL_REPLAY_VERIFY_FAILED";

export interface RecoveryDiagnostic {
  readonly code: RecoveryDiagnosticCode;
  readonly journalPath: string;
  readonly message: string;
}

export interface RecoveryResult {
  readonly actions: readonly {
    readonly transactionId: string;
    readonly action: RecoveryAction;
    readonly targetPath: string;
  }[];
  readonly diagnostics: readonly RecoveryDiagnostic[];
}

export const JOURNAL_ROOT = "/.aistudio/journal";

export function journalPath(transactionId: string): string {
  const id = transactionId.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error("transactionId must use only letters, numbers, dot, underscore or dash.");
  }
  return `${JOURNAL_ROOT}/${id}.json`;
}

export function fingerprintBytes(data: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of data) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${data.byteLength}:${hash.toString(16).padStart(8, "0")}`;
}

export function encodeJournalRecord(record: JournalRecord): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    version: record.version,
    transactionId: record.transactionId,
    targetPath: record.targetPath,
    tempPath: record.tempPath,
    revision: record.revision,
    payloadFingerprint: record.payloadFingerprint,
    phase: record.phase,
  }));
}

export function decodeJournalRecord(data: Uint8Array): JournalRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(data));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const candidate = parsed as Record<string, unknown>;
    if (
      candidate.version !== 1
      || typeof candidate.transactionId !== "string"
      || typeof candidate.targetPath !== "string"
      || typeof candidate.tempPath !== "string"
      || typeof candidate.revision !== "number"
      || !Number.isSafeInteger(candidate.revision)
      || candidate.revision < 0
      || typeof candidate.payloadFingerprint !== "string"
      || (candidate.phase !== "BEGIN" && candidate.phase !== "COMMIT")
    ) return undefined;
    journalPath(candidate.transactionId);
    return Object.freeze({
      version: 1,
      transactionId: candidate.transactionId,
      targetPath: candidate.targetPath,
      tempPath: candidate.tempPath,
      revision: candidate.revision,
      payloadFingerprint: candidate.payloadFingerprint,
      phase: candidate.phase,
    });
  } catch {
    return undefined;
  }
}

function makeRecord(
  input: JournaledSaveInput,
  phase: JournalPhase,
): JournalRecord {
  const plan = createAtomicSavePlan(input.targetPath, input.revision);
  return Object.freeze({
    version: 1,
    transactionId: input.transactionId.trim(),
    targetPath: plan.targetPath,
    tempPath: plan.tempPath,
    revision: input.revision,
    payloadFingerprint: fingerprintBytes(input.data),
    phase,
  });
}

export async function saveJournaled(
  adapter: BinaryStorageAdapter,
  input: JournaledSaveInput,
): Promise<AtomicSaveResult> {
  const path = journalPath(input.transactionId);
  const begin = makeRecord(input, "BEGIN");
  await adapter.write(path, encodeJournalRecord(begin));

  const result = await saveAtomically(
    adapter,
    createAtomicSavePlan(input.targetPath, input.revision),
    input.data,
  );

  if (!result.committed) {
    await adapter.remove(path);
    return result;
  }

  await adapter.write(path, encodeJournalRecord(makeRecord(input, "COMMIT")));
  await adapter.remove(path);
  return result;
}

async function matchesFingerprint(
  adapter: BinaryStorageAdapter,
  path: string,
  expected: string,
): Promise<boolean> {
  const data = await adapter.read(path);
  return data !== undefined && fingerprintBytes(data) === expected;
}

export async function recoverProjectJournals(
  adapter: BinaryStorageAdapter,
): Promise<RecoveryResult> {
  const paths = await adapter.list(JOURNAL_ROOT);
  const actions: Array<{ transactionId: string; action: RecoveryAction; targetPath: string }> = [];
  const diagnostics: RecoveryDiagnostic[] = [];

  for (const path of paths) {
    const encoded = await adapter.read(path);
    const record = encoded === undefined ? undefined : decodeJournalRecord(encoded);
    if (record === undefined) {
      diagnostics.push({ code: "JOURNAL_CORRUPT", journalPath: path, message: "Journal record cannot be decoded safely." });
      continue;
    }

    if (await matchesFingerprint(adapter, record.targetPath, record.payloadFingerprint)) {
      await adapter.remove(record.tempPath);
      await adapter.remove(path);
      actions.push({ transactionId: record.transactionId, action: "FINALIZED_TARGET", targetPath: record.targetPath });
      continue;
    }

    if (!(await matchesFingerprint(adapter, record.tempPath, record.payloadFingerprint))) {
      diagnostics.push({
        code: "JOURNAL_PAYLOAD_MISSING_OR_CORRUPT",
        journalPath: path,
        message: "Neither target nor temporary payload matches the journal fingerprint.",
      });
      continue;
    }

    if (!adapter.atomicReplace) {
      diagnostics.push({
        code: "JOURNAL_REPLACE_NOT_ATOMIC",
        journalPath: path,
        message: `Storage backend ${adapter.kind} cannot safely replay the temporary payload.`,
      });
      continue;
    }

    await adapter.replace(record.tempPath, record.targetPath);
    if (!(await matchesFingerprint(adapter, record.targetPath, record.payloadFingerprint))) {
      diagnostics.push({
        code: "JOURNAL_REPLAY_VERIFY_FAILED",
        journalPath: path,
        message: "Replayed payload failed post-replace verification.",
      });
      continue;
    }

    await adapter.remove(path);
    actions.push({ transactionId: record.transactionId, action: "REPLAYED_TEMP", targetPath: record.targetPath });
  }

  return Object.freeze({ actions: Object.freeze(actions), diagnostics: Object.freeze(diagnostics) });
}
