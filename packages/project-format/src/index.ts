import {
  deserializeProject,
  serializeProject,
  type StudioProject,
} from "@aistudio/core-project";

export const AISTUDIO_PACKAGE_FORMAT = "aistudio-package" as const;
export const AISTUDIO_PACKAGE_FORMAT_VERSION = 1 as const;
export const AISTUDIO_PACKAGE_EXTENSION = ".aistudio" as const;
export const PACKAGE_METADATA_PATH = "META/package.json" as const;
export const PACKAGE_CHECKSUMS_PATH = "META/checksums.json" as const;
export const PROJECT_SNAPSHOT_PATH = "PROJECT/project.json" as const;

const UTF8_FLAG = 0x0800;
const ZIP32_MAX = 0xffff_ffff;
const MAX_ZIP_ENTRIES = 0xffff;
const DOS_EPOCH_DATE = 0x0021;

export type AistudioPackageErrorCode =
  | "AISTUDIO_INVALID_ZIP"
  | "AISTUDIO_UNSUPPORTED_COMPRESSION"
  | "AISTUDIO_INVALID_PATH"
  | "AISTUDIO_DUPLICATE_ENTRY"
  | "AISTUDIO_RESERVED_ENTRY"
  | "AISTUDIO_MISSING_ENTRY"
  | "AISTUDIO_INVALID_METADATA"
  | "AISTUDIO_UNSUPPORTED_VERSION"
  | "AISTUDIO_INVALID_CHECKSUMS"
  | "AISTUDIO_CHECKSUM_MISMATCH"
  | "AISTUDIO_PROJECT_MISMATCH"
  | "AISTUDIO_CRYPTO_UNAVAILABLE"
  | "AISTUDIO_ZIP_CRC_MISMATCH";

export class AistudioPackageError extends Error {
  readonly code: AistudioPackageErrorCode;

  constructor(code: AistudioPackageErrorCode, message: string) {
    super(message);
    this.name = "AistudioPackageError";
    this.code = code;
  }
}

export interface AistudioArchiveEntry {
  readonly path: string;
  readonly data: Uint8Array;
}

export interface AistudioPackageMetadata {
  readonly format: typeof AISTUDIO_PACKAGE_FORMAT;
  readonly formatVersion: typeof AISTUDIO_PACKAGE_FORMAT_VERSION;
  readonly projectEntry: typeof PROJECT_SNAPSHOT_PATH;
  readonly checksumsEntry: typeof PACKAGE_CHECKSUMS_PATH;
  readonly projectFormatVersion: number;
  readonly projectId: string;
  readonly projectName: string;
}

export interface AistudioChecksumDocument {
  readonly algorithm: "SHA-256";
  readonly entries: Readonly<Record<string, string>>;
}

export interface AistudioImportedPackage {
  readonly project: StudioProject;
  readonly metadata: AistudioPackageMetadata;
  readonly checksums: AistudioChecksumDocument;
  readonly extraEntries: readonly AistudioArchiveEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return value;

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = stableJsonValue(value[key]);
  }
  return result;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

function copyBytes(data: Uint8Array): Uint8Array {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function ensureRange(total: number, offset: number, length: number, message: string): void {
  if (
    !Number.isInteger(offset)
    || !Number.isInteger(length)
    || offset < 0
    || length < 0
    || offset + length > total
  ) {
    throw new AistudioPackageError("AISTUDIO_INVALID_ZIP", message);
  }
}

function validateArchivePath(path: string): void {
  const encoded = new TextEncoder().encode(path);
  const segments = path.split("/");
  if (
    path.length === 0
    || path.startsWith("/")
    || path.endsWith("/")
    || path.includes("\\")
    || encoded.byteLength > 0xffff
    || segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new AistudioPackageError(
      "AISTUDIO_INVALID_PATH",
      `Invalid .aistudio archive path: ${path || "<empty>"}.`,
    );
  }
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let value = 0xffff_ffff;
  for (let index = 0; index < data.byteLength; index += 1) {
    const byte = data[index] ?? 0;
    const tableValue = CRC32_TABLE[(value ^ byte) & 0xff] ?? 0;
    value = tableValue ^ (value >>> 8);
  }
  return (value ^ 0xffff_ffff) >>> 0;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new AistudioPackageError(
      "AISTUDIO_CRYPTO_UNAVAILABLE",
      "Web Crypto SHA-256 is unavailable in this runtime.",
    );
  }

  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const digest = await subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

interface PreparedZipEntry {
  readonly path: string;
  readonly nameBytes: Uint8Array;
  readonly data: Uint8Array;
  readonly crc: number;
  readonly localOffset: number;
}

export function encodeStoredZip(entries: readonly AistudioArchiveEntry[]): Uint8Array {
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new AistudioPackageError("AISTUDIO_INVALID_ZIP", "ZIP32 entry limit exceeded.");
  }

  const sorted = [...entries]
    .map((entry) => ({ path: entry.path, data: copyBytes(entry.data) }))
    .sort((left, right) => left.path.localeCompare(right.path));

  const seen = new Set<string>();
  const localParts: Uint8Array[] = [];
  const prepared: PreparedZipEntry[] = [];
  let localOffset = 0;

  for (const entry of sorted) {
    validateArchivePath(entry.path);
    if (seen.has(entry.path)) {
      throw new AistudioPackageError(
        "AISTUDIO_DUPLICATE_ENTRY",
        `Duplicate .aistudio archive entry: ${entry.path}.`,
      );
    }
    seen.add(entry.path);

    if (entry.data.byteLength > ZIP32_MAX || localOffset > ZIP32_MAX) {
      throw new AistudioPackageError("AISTUDIO_INVALID_ZIP", "ZIP32 size limit exceeded.");
    }

    const nameBytes = new TextEncoder().encode(entry.path);
    const crc = crc32(entry.data);
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, UTF8_FLAG, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, DOS_EPOCH_DATE, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, entry.data.byteLength, true);
    view.setUint32(22, entry.data.byteLength, true);
    view.setUint16(26, nameBytes.byteLength, true);
    view.setUint16(28, 0, true);

    prepared.push({
      path: entry.path,
      nameBytes,
      data: entry.data,
      crc,
      localOffset,
    });
    localParts.push(header, nameBytes, entry.data);
    localOffset += header.byteLength + nameBytes.byteLength + entry.data.byteLength;
  }

  if (localOffset > ZIP32_MAX) {
    throw new AistudioPackageError("AISTUDIO_INVALID_ZIP", "ZIP32 archive offset limit exceeded.");
  }

  const centralParts: Uint8Array[] = [];
  let centralSize = 0;
  for (const entry of prepared) {
    const header = new Uint8Array(46);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, UTF8_FLAG, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, DOS_EPOCH_DATE, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.data.byteLength, true);
    view.setUint32(24, entry.data.byteLength, true);
    view.setUint16(28, entry.nameBytes.byteLength, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, entry.localOffset, true);
    centralParts.push(header, entry.nameBytes);
    centralSize += header.byteLength + entry.nameBytes.byteLength;
  }

  if (centralSize > ZIP32_MAX) {
    throw new AistudioPackageError("AISTUDIO_INVALID_ZIP", "ZIP32 central-directory limit exceeded.");
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, prepared.length, true);
  endView.setUint16(10, prepared.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);

  return concatBytes([...localParts, ...centralParts, end]);
}

function findEndOfCentralDirectory(archive: Uint8Array, view: DataView): number {
  const minimum = 22;
  if (archive.byteLength < minimum) {
    throw new AistudioPackageError("AISTUDIO_INVALID_ZIP", "Archive is too small to be a ZIP file.");
  }

  const earliest = Math.max(0, archive.byteLength - minimum - 0xffff);
  for (let offset = archive.byteLength - minimum; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + minimum + commentLength === archive.byteLength) return offset;
  }

  throw new AistudioPackageError("AISTUDIO_INVALID_ZIP", "ZIP end-of-central-directory record not found.");
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AistudioPackageError("AISTUDIO_INVALID_ZIP", `${label} is not valid UTF-8.`);
  }
}

export function readStoredZip(archiveInput: Uint8Array): ReadonlyMap<string, Uint8Array> {
  const archive = copyBytes(archiveInput);
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const endOffset = findEndOfCentralDirectory(archive, view);
  ensureRange(archive.byteLength, endOffset, 22, "Truncated ZIP end record.");

  const disk = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const entriesOnDisk = view.getUint16(endOffset + 8, true);
  const totalEntries = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new AistudioPackageError("AISTUDIO_INVALID_ZIP", "Multi-disk ZIP archives are unsupported.");
  }
  ensureRange(
    archive.byteLength,
    centralOffset,
    centralSize,
    "ZIP central directory points outside the archive.",
  );
  if (centralOffset + centralSize > endOffset) {
    throw new AistudioPackageError("AISTUDIO_INVALID_ZIP", "ZIP central directory overlaps the end record.");
  }

  const entries = new Map<string, Uint8Array>();
  let pointer = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    ensureRange(archive.byteLength, pointer, 46, "Truncated ZIP central-directory entry.");
    if (view.getUint32(pointer, true) !== 0x02014b50) {
      throw new AistudioPackageError("AISTUDIO_INVALID_ZIP", "Invalid ZIP central-directory signature.");
    }

    const flags = view.getUint16(pointer + 8, true);
    const method = view.getUint16(pointer + 10, true);
    const expectedCrc = view.getUint32(pointer + 16, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const uncompressedSize = view.getUint32(pointer + 24, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const diskStart = view.getUint16(pointer + 34, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const entryLength = 46 + nameLength + extraLength + commentLength;
    ensureRange(archive.byteLength, pointer, entryLength, "Truncated ZIP central-directory payload.");

    if ((flags & 0x0001) !== 0 || (flags & 0x0008) !== 0 || diskStart !== 0) {
      throw new AistudioPackageError(
        "AISTUDIO_INVALID_ZIP",
        "Encrypted, data-descriptor, or multi-disk ZIP entries are unsupported.",
      );
    }
    if (method !== 0) {
      throw new AistudioPackageError(
        "AISTUDIO_UNSUPPORTED_COMPRESSION",
        `Unsupported ZIP compression method ${method}; .aistudio v1 uses STORE entries.`,
      );
    }
    if (compressedSize !== uncompressedSize) {
      throw new AistudioPackageError("AISTUDIO_INVALID_ZIP", "STORE ZIP entry has mismatched sizes.");
    }

    const nameStart = pointer + 46;
    const path = decodeUtf8(archive.subarray(nameStart, nameStart + nameLength), "ZIP entry name");
    validateArchivePath(path);
    if (entries.has(path)) {
      throw new AistudioPackageError("AISTUDIO_DUPLICATE_ENTRY", `Duplicate ZIP entry: ${path}.`);
    }

    ensureRange(archive.byteLength, localOffset, 30, "ZIP local header points outside the archive.");
    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new AistudioPackageError("AISTUDIO_INVALID_ZIP", `Invalid local header for ${path}.`);
    }

    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    const localCrc = view.getUint32(localOffset + 14, true);
    const localCompressedSize = view.getUint32(localOffset + 18, true);
    const localUncompressedSize = view.getUint32(localOffset + 22, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    ensureRange(
      archive.byteLength,
      localOffset,
      30 + localNameLength + localExtraLength,
      `Truncated local ZIP header for ${path}.`,
    );

    const localNameStart = localOffset + 30;
    const localPath = decodeUtf8(
      archive.subarray(localNameStart, localNameStart + localNameLength),
      "ZIP local entry name",
    );
    if (
      localPath !== path
      || localFlags !== flags
      || localMethod !== method
      || localCrc !== expectedCrc
      || localCompressedSize !== compressedSize
      || localUncompressedSize !== uncompressedSize
    ) {
      throw new AistudioPackageError("AISTUDIO_INVALID_ZIP", `Central/local ZIP metadata mismatch for ${path}.`);
    }

    const dataStart = localNameStart + localNameLength + localExtraLength;
    ensureRange(archive.byteLength, dataStart, compressedSize, `Truncated ZIP data for ${path}.`);
    const data = archive.subarray(dataStart, dataStart + compressedSize);
    if (crc32(data) !== expectedCrc) {
      throw new AistudioPackageError(
        "AISTUDIO_ZIP_CRC_MISMATCH",
        `ZIP CRC-32 mismatch for ${path}.`,
      );
    }

    entries.set(path, copyBytes(data));
    pointer += entryLength;
  }

  if (pointer !== centralOffset + centralSize) {
    throw new AistudioPackageError("AISTUDIO_INVALID_ZIP", "ZIP central-directory size does not match its entries.");
  }

  return entries;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new AistudioPackageError("AISTUDIO_INVALID_METADATA", `${label} is not valid JSON.`);
  }
}

function parseMetadata(bytes: Uint8Array): AistudioPackageMetadata {
  const parsed = parseJson(bytes, PACKAGE_METADATA_PATH);
  if (!isRecord(parsed) || parsed.format !== AISTUDIO_PACKAGE_FORMAT) {
    throw new AistudioPackageError("AISTUDIO_INVALID_METADATA", "Invalid .aistudio package metadata.");
  }
  if (parsed.formatVersion !== AISTUDIO_PACKAGE_FORMAT_VERSION) {
    throw new AistudioPackageError(
      "AISTUDIO_UNSUPPORTED_VERSION",
      `Unsupported .aistudio package version: ${String(parsed.formatVersion)}.`,
    );
  }
  if (
    parsed.projectEntry !== PROJECT_SNAPSHOT_PATH
    || parsed.checksumsEntry !== PACKAGE_CHECKSUMS_PATH
    || typeof parsed.projectFormatVersion !== "number"
    || !Number.isInteger(parsed.projectFormatVersion)
    || parsed.projectFormatVersion < 0
    || typeof parsed.projectId !== "string"
    || parsed.projectId.length === 0
    || typeof parsed.projectName !== "string"
    || parsed.projectName.trim().length === 0
  ) {
    throw new AistudioPackageError("AISTUDIO_INVALID_METADATA", "Malformed .aistudio package metadata fields.");
  }

  return Object.freeze({
    format: AISTUDIO_PACKAGE_FORMAT,
    formatVersion: AISTUDIO_PACKAGE_FORMAT_VERSION,
    projectEntry: PROJECT_SNAPSHOT_PATH,
    checksumsEntry: PACKAGE_CHECKSUMS_PATH,
    projectFormatVersion: parsed.projectFormatVersion,
    projectId: parsed.projectId,
    projectName: parsed.projectName,
  });
}

function parseChecksums(bytes: Uint8Array): AistudioChecksumDocument {
  const parsed = parseJson(bytes, PACKAGE_CHECKSUMS_PATH);
  if (!isRecord(parsed) || parsed.algorithm !== "SHA-256" || !isRecord(parsed.entries)) {
    throw new AistudioPackageError("AISTUDIO_INVALID_CHECKSUMS", "Invalid .aistudio checksum document.");
  }

  const entries: Record<string, string> = {};
  for (const [path, digest] of Object.entries(parsed.entries)) {
    validateArchivePath(path);
    if (path === PACKAGE_CHECKSUMS_PATH || typeof digest !== "string" || !/^[a-f0-9]{64}$/i.test(digest)) {
      throw new AistudioPackageError("AISTUDIO_INVALID_CHECKSUMS", `Invalid checksum entry for ${path}.`);
    }
    entries[path] = digest.toLowerCase();
  }

  return Object.freeze({
    algorithm: "SHA-256" as const,
    entries: Object.freeze(entries),
  });
}

async function verifyChecksums(
  entries: ReadonlyMap<string, Uint8Array>,
  checksums: AistudioChecksumDocument,
): Promise<void> {
  const payloadPaths = [...entries.keys()]
    .filter((path) => path !== PACKAGE_CHECKSUMS_PATH)
    .sort();
  const checksumPaths = Object.keys(checksums.entries).sort();
  if (
    payloadPaths.length !== checksumPaths.length
    || payloadPaths.some((path, index) => path !== checksumPaths[index])
  ) {
    throw new AistudioPackageError(
      "AISTUDIO_INVALID_CHECKSUMS",
      "Checksum document does not cover exactly every non-checksum package entry.",
    );
  }

  for (const path of payloadPaths) {
    const data = entries.get(path);
    const expected = checksums.entries[path];
    if (data === undefined || expected === undefined) {
      throw new AistudioPackageError("AISTUDIO_INVALID_CHECKSUMS", `Missing checksum coverage for ${path}.`);
    }
    const actual = await sha256Hex(data);
    if (actual !== expected) {
      throw new AistudioPackageError(
        "AISTUDIO_CHECKSUM_MISMATCH",
        `SHA-256 mismatch for ${path}: expected ${expected}, got ${actual}.`,
      );
    }
  }
}

function requireEntry(entries: ReadonlyMap<string, Uint8Array>, path: string): Uint8Array {
  const value = entries.get(path);
  if (value === undefined) {
    throw new AistudioPackageError("AISTUDIO_MISSING_ENTRY", `Required .aistudio entry is missing: ${path}.`);
  }
  return value;
}

function isReservedPath(path: string): boolean {
  return path === PACKAGE_METADATA_PATH || path === PACKAGE_CHECKSUMS_PATH || path === PROJECT_SNAPSHOT_PATH;
}

export async function exportAistudioPackage(
  project: StudioProject,
  extraEntries: readonly AistudioArchiveEntry[] = [],
): Promise<Uint8Array> {
  const metadata: AistudioPackageMetadata = Object.freeze({
    format: AISTUDIO_PACKAGE_FORMAT,
    formatVersion: AISTUDIO_PACKAGE_FORMAT_VERSION,
    projectEntry: PROJECT_SNAPSHOT_PATH,
    checksumsEntry: PACKAGE_CHECKSUMS_PATH,
    projectFormatVersion: project.formatVersion,
    projectId: project.projectId,
    projectName: project.name,
  });

  const metadataBytes = new TextEncoder().encode(stableJson(metadata));
  const projectBytes = new TextEncoder().encode(serializeProject(project));
  const payloadEntries: AistudioArchiveEntry[] = [
    { path: PACKAGE_METADATA_PATH, data: metadataBytes },
    { path: PROJECT_SNAPSHOT_PATH, data: projectBytes },
  ];
  const seen = new Set<string>(payloadEntries.map((entry) => entry.path));

  for (const entry of extraEntries) {
    validateArchivePath(entry.path);
    if (isReservedPath(entry.path)) {
      throw new AistudioPackageError(
        "AISTUDIO_RESERVED_ENTRY",
        `Extra entry may not replace reserved package path ${entry.path}.`,
      );
    }
    if (seen.has(entry.path)) {
      throw new AistudioPackageError("AISTUDIO_DUPLICATE_ENTRY", `Duplicate package entry ${entry.path}.`);
    }
    seen.add(entry.path);
    payloadEntries.push({ path: entry.path, data: copyBytes(entry.data) });
  }

  const digestEntries: Record<string, string> = {};
  for (const entry of [...payloadEntries].sort((left, right) => left.path.localeCompare(right.path))) {
    digestEntries[entry.path] = await sha256Hex(entry.data);
  }
  const checksums: AistudioChecksumDocument = Object.freeze({
    algorithm: "SHA-256" as const,
    entries: Object.freeze(digestEntries),
  });
  const checksumBytes = new TextEncoder().encode(stableJson(checksums));

  return encodeStoredZip([
    ...payloadEntries,
    { path: PACKAGE_CHECKSUMS_PATH, data: checksumBytes },
  ]);
}

export async function importAistudioPackage(archive: Uint8Array): Promise<AistudioImportedPackage> {
  const entries = readStoredZip(archive);
  const checksumBytes = requireEntry(entries, PACKAGE_CHECKSUMS_PATH);
  const checksums = parseChecksums(checksumBytes);
  await verifyChecksums(entries, checksums);

  const metadata = parseMetadata(requireEntry(entries, PACKAGE_METADATA_PATH));
  const projectBytes = requireEntry(entries, PROJECT_SNAPSHOT_PATH);
  const project = deserializeProject(new TextDecoder().decode(projectBytes));

  if (
    project.projectId !== metadata.projectId
    || project.name !== metadata.projectName
    || project.formatVersion !== metadata.projectFormatVersion
  ) {
    throw new AistudioPackageError(
      "AISTUDIO_PROJECT_MISMATCH",
      "Package metadata does not match the canonical project snapshot.",
    );
  }

  const extraEntries = [...entries.entries()]
    .filter(([path]) => !isReservedPath(path))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, data]) => Object.freeze({ path, data: copyBytes(data) }));

  return Object.freeze({
    project,
    metadata,
    checksums,
    extraEntries: Object.freeze(extraEntries),
  });
}

export function aistudioPackageFilename(project: StudioProject): string {
  const base = project.name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "project"}${AISTUDIO_PACKAGE_EXTENSION}`;
}
