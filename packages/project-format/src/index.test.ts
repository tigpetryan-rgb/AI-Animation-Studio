import { describe, expect, it } from "vitest";
import { createStudioProject, serializeProject } from "@aistudio/core-project";
import { asProjectId } from "@aistudio/core-types";
import {
  AistudioPackageError,
  PACKAGE_CHECKSUMS_PATH,
  PACKAGE_METADATA_PATH,
  PROJECT_SNAPSHOT_PATH,
  encodeStoredZip,
  exportAistudioPackage,
  importAistudioPackage,
  readStoredZip,
  sha256Hex,
  type AistudioArchiveEntry,
} from "./index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function project() {
  return createStudioProject({
    projectId: asProjectId("project-portable-v1"),
    name: "Portable Movie",
  });
}

function rebuiltEntries(
  entries: ReadonlyMap<string, Uint8Array>,
  replacements: Readonly<Record<string, Uint8Array>>,
): AistudioArchiveEntry[] {
  return [...entries.entries()].map(([path, data]) => ({
    path,
    data: replacements[path] ?? data,
  }));
}

describe("portable .aistudio package", () => {
  it("exports a deterministic ZIP-compatible package and round-trips the canonical project", async () => {
    const source = project();
    const extras: readonly AistudioArchiveEntry[] = [
      { path: "STORY/story.json", data: encoder.encode('{"title":"Golden Movie"}') },
      { path: "ASSETS/notes/readme.txt", data: encoder.encode("portable asset evidence") },
    ];

    const archive = await exportAistudioPackage(source, extras);
    expect([...archive.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const rawEntries = readStoredZip(archive);
    expect([...rawEntries.keys()].sort()).toEqual([
      "ASSETS/notes/readme.txt",
      "META/checksums.json",
      "META/package.json",
      "PROJECT/project.json",
      "STORY/story.json",
    ]);

    const imported = await importAistudioPackage(archive);
    expect(serializeProject(imported.project)).toBe(serializeProject(source));
    expect(imported.metadata.projectId).toBe(source.projectId);
    expect(imported.metadata.projectName).toBe(source.name);
    expect(imported.extraEntries.map((entry) => entry.path)).toEqual([
      "ASSETS/notes/readme.txt",
      "STORY/story.json",
    ]);

    const reexported = await exportAistudioPackage(imported.project, imported.extraEntries);
    expect(reexported).toEqual(archive);
  });

  it("rejects a package whose SHA-256 checksum no longer matches the project snapshot", async () => {
    const archive = await exportAistudioPackage(project());
    const entries = readStoredZip(archive);
    const checksumDocument = JSON.parse(
      decoder.decode(entries.get(PACKAGE_CHECKSUMS_PATH)),
    ) as { algorithm: string; entries: Record<string, string> };
    checksumDocument.entries[PROJECT_SNAPSHOT_PATH] = "0".repeat(64);
    const tamperedChecksums = encoder.encode(JSON.stringify(checksumDocument));
    const tamperedArchive = encodeStoredZip(
      rebuiltEntries(entries, { [PACKAGE_CHECKSUMS_PATH]: tamperedChecksums }),
    );

    await expect(importAistudioPackage(tamperedArchive)).rejects.toMatchObject({
      code: "AISTUDIO_CHECKSUM_MISMATCH",
    });
  });

  it("rejects an unsupported package version after checksum verification", async () => {
    const archive = await exportAistudioPackage(project());
    const entries = readStoredZip(archive);
    const metadata = JSON.parse(
      decoder.decode(entries.get(PACKAGE_METADATA_PATH)),
    ) as Record<string, unknown>;
    metadata.formatVersion = 2;
    const changedMetadata = encoder.encode(JSON.stringify(metadata));

    const checksumDocument = JSON.parse(
      decoder.decode(entries.get(PACKAGE_CHECKSUMS_PATH)),
    ) as { algorithm: string; entries: Record<string, string> };
    checksumDocument.entries[PACKAGE_METADATA_PATH] = await sha256Hex(changedMetadata);
    const changedChecksums = encoder.encode(JSON.stringify(checksumDocument));

    const changedArchive = encodeStoredZip(rebuiltEntries(entries, {
      [PACKAGE_METADATA_PATH]: changedMetadata,
      [PACKAGE_CHECKSUMS_PATH]: changedChecksums,
    }));

    await expect(importAistudioPackage(changedArchive)).rejects.toMatchObject({
      code: "AISTUDIO_UNSUPPORTED_VERSION",
    });
  });

  it("rejects metadata that is correctly checksummed but bound to a different project", async () => {
    const archive = await exportAistudioPackage(project());
    const entries = readStoredZip(archive);
    const metadata = JSON.parse(
      decoder.decode(entries.get(PACKAGE_METADATA_PATH)),
    ) as Record<string, unknown>;
    metadata.projectId = "project-other";
    const changedMetadata = encoder.encode(JSON.stringify(metadata));

    const checksumDocument = JSON.parse(
      decoder.decode(entries.get(PACKAGE_CHECKSUMS_PATH)),
    ) as { algorithm: string; entries: Record<string, string> };
    checksumDocument.entries[PACKAGE_METADATA_PATH] = await sha256Hex(changedMetadata);
    const changedChecksums = encoder.encode(JSON.stringify(checksumDocument));

    const changedArchive = encodeStoredZip(rebuiltEntries(entries, {
      [PACKAGE_METADATA_PATH]: changedMetadata,
      [PACKAGE_CHECKSUMS_PATH]: changedChecksums,
    }));

    await expect(importAistudioPackage(changedArchive)).rejects.toMatchObject({
      code: "AISTUDIO_PROJECT_MISMATCH",
    });
  });

  it("blocks path traversal and reserved-entry replacement", async () => {
    expect(() => encodeStoredZip([
      { path: "../escape.txt", data: encoder.encode("no") },
    ])).toThrowError(AistudioPackageError);

    await expect(exportAistudioPackage(project(), [
      { path: PROJECT_SNAPSHOT_PATH, data: encoder.encode("replacement") },
    ])).rejects.toMatchObject({ code: "AISTUDIO_RESERVED_ENTRY" });
  });
});
