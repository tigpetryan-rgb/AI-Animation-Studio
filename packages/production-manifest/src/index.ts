import type { ModelBackend, ModelQuantization, ModelTask } from "@aistudio/ai-runtime";

export type ManifestDependencyKind = "ASSET" | "MODEL" | "ENGINE" | "RECIPE" | "TAKE";
export type ReproducibilityStatus = "READY" | "INCOMPLETE" | "INVALID";

export interface ContentDependency {
  readonly id: string;
  readonly kind: "IMAGE" | "VIDEO" | "AUDIO" | "MESH" | "MATERIAL" | "OTHER";
  readonly sha256: string;
}

export interface ModelDependency {
  readonly id: string;
  readonly version: string;
  readonly sha256: string;
  readonly task: ModelTask;
  readonly quantization: ModelQuantization;
  readonly backend: ModelBackend;
  readonly adapterId: string;
  readonly adapterVersion: string;
}

export interface EngineDependency {
  readonly id: string;
  readonly version: string;
}

export interface RecipeDependency {
  readonly id: string;
  readonly sha256: string;
}

export interface ApprovedTakeDependency {
  readonly sceneId: string;
  readonly shotId: string;
  readonly takeId: string;
  readonly artifactSha256: string;
}

export interface UnresolvedDependency {
  readonly kind: ManifestDependencyKind;
  readonly id: string;
  readonly reason: string;
}

export interface ProductionEvidence {
  readonly createdAt: string;
  readonly studioVersion: string;
  readonly capabilityTier?: string;
  readonly renderer?: string;
  readonly compute?: string;
  readonly storage?: string;
  readonly codec?: string;
  readonly browserLabel?: string;
}

export interface ProductionManifest {
  readonly format: "aistudio-production-manifest";
  readonly formatVersion: 1;
  readonly projectId: string;
  readonly projectRevision: number;
  readonly projectStateSha256: string;
  readonly storyIrVersion: string;
  readonly storyIrSha256: string;
  readonly sceneIds: readonly string[];
  readonly shotIds: readonly string[];
  readonly assets: readonly ContentDependency[];
  readonly models: readonly ModelDependency[];
  readonly engines: readonly EngineDependency[];
  readonly recipes: readonly RecipeDependency[];
  readonly approvedTakes: readonly ApprovedTakeDependency[];
  readonly unresolved: readonly UnresolvedDependency[];
  readonly evidence: ProductionEvidence;
}

export type ManifestDiagnosticCode =
  | "MANIFEST_EMPTY_ID"
  | "MANIFEST_INVALID_REVISION"
  | "MANIFEST_INVALID_HASH"
  | "MANIFEST_DUPLICATE_DEPENDENCY"
  | "MANIFEST_INVALID_UNRESOLVED";

export interface ManifestDiagnostic {
  readonly code: ManifestDiagnosticCode;
  readonly message: string;
  readonly ref?: string;
}

export interface ReproducibilityAssessment {
  readonly status: ReproducibilityStatus;
  readonly diagnostics: readonly ManifestDiagnostic[];
  readonly unresolved: readonly UnresolvedDependency[];
}

export interface ManifestDigest {
  readonly algorithm: "SHA-256";
  readonly sha256: string;
  readonly canonicalPayload: string;
}

export type DigestProvider = (bytes: Uint8Array) => Promise<Uint8Array>;

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function freezeArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

function sortStrings(values: readonly string[]): readonly string[] {
  return freezeArray([...values].sort((a, b) => a.localeCompare(b)));
}

function sortByKey<T>(values: readonly T[], key: (value: T) => string): readonly T[] {
  return freezeArray([...values].sort((a, b) => key(a).localeCompare(key(b))));
}

export function normalizeProductionManifest(manifest: ProductionManifest): ProductionManifest {
  return Object.freeze({
    ...manifest,
    sceneIds: sortStrings(manifest.sceneIds),
    shotIds: sortStrings(manifest.shotIds),
    assets: sortByKey(manifest.assets, (item) => `${item.id}\u0000${item.sha256}`),
    models: sortByKey(manifest.models, (item) => `${item.id}\u0000${item.version}\u0000${item.sha256}`),
    engines: sortByKey(manifest.engines, (item) => `${item.id}\u0000${item.version}`),
    recipes: sortByKey(manifest.recipes, (item) => `${item.id}\u0000${item.sha256}`),
    approvedTakes: sortByKey(manifest.approvedTakes, (item) => `${item.sceneId}\u0000${item.shotId}\u0000${item.takeId}`),
    unresolved: sortByKey(manifest.unresolved, (item) => `${item.kind}\u0000${item.id}\u0000${item.reason}`),
    evidence: Object.freeze({ ...manifest.evidence }),
  });
}

function duplicateKeys(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort((a, b) => a.localeCompare(b));
}

export function validateProductionManifest(manifest: ProductionManifest): readonly ManifestDiagnostic[] {
  const diagnostics: ManifestDiagnostic[] = [];
  const requiredIds: readonly [string, string][] = [
    ["projectId", manifest.projectId],
    ["storyIrVersion", manifest.storyIrVersion],
  ];
  for (const [name, value] of requiredIds) {
    if (value.trim().length === 0) diagnostics.push({ code: "MANIFEST_EMPTY_ID", message: `${name} must not be empty.`, ref: name });
  }
  if (!Number.isSafeInteger(manifest.projectRevision) || manifest.projectRevision < 0) {
    diagnostics.push({ code: "MANIFEST_INVALID_REVISION", message: "projectRevision must be a non-negative safe integer.", ref: "projectRevision" });
  }

  const hashes: readonly (readonly [string, string])[] = [
    ["projectStateSha256", manifest.projectStateSha256],
    ["storyIrSha256", manifest.storyIrSha256],
    ...manifest.assets.map((item) => [`asset:${item.id}`, item.sha256] as const),
    ...manifest.models.map((item) => [`model:${item.id}@${item.version}`, item.sha256] as const),
    ...manifest.recipes.map((item) => [`recipe:${item.id}`, item.sha256] as const),
    ...manifest.approvedTakes.map((item) => [`take:${item.takeId}`, item.artifactSha256] as const),
  ];
  for (const [ref, hash] of hashes) {
    if (!isSha256(hash)) diagnostics.push({ code: "MANIFEST_INVALID_HASH", message: `${ref} must contain a SHA-256 hex digest.`, ref });
  }

  const identityGroups: readonly [string, readonly string[]][] = [
    ["scene", manifest.sceneIds],
    ["shot", manifest.shotIds],
    ["asset", manifest.assets.map((item) => item.id)],
    ["model", manifest.models.map((item) => `${item.id}@${item.version}`)],
    ["engine", manifest.engines.map((item) => item.id)],
    ["recipe", manifest.recipes.map((item) => item.id)],
    ["take", manifest.approvedTakes.map((item) => item.takeId)],
  ];
  for (const [kind, values] of identityGroups) {
    for (const duplicate of duplicateKeys(values)) {
      diagnostics.push({ code: "MANIFEST_DUPLICATE_DEPENDENCY", message: `Duplicate ${kind} dependency ${duplicate}.`, ref: `${kind}:${duplicate}` });
    }
  }

  for (const unresolved of manifest.unresolved) {
    if (unresolved.id.trim().length === 0 || unresolved.reason.trim().length === 0) {
      diagnostics.push({ code: "MANIFEST_INVALID_UNRESOLVED", message: "Unresolved dependency records require a non-empty id and reason.", ref: unresolved.id });
    }
  }
  return Object.freeze(diagnostics);
}

export function assessReproducibility(manifest: ProductionManifest): ReproducibilityAssessment {
  const diagnostics = validateProductionManifest(manifest);
  const status: ReproducibilityStatus = diagnostics.length > 0
    ? "INVALID"
    : manifest.unresolved.length > 0
      ? "INCOMPLETE"
      : "READY";
  return Object.freeze({ status, diagnostics, unresolved: freezeArray(manifest.unresolved) });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Readonly<Record<string, unknown>>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort((a, b) => a.localeCompare(b))) {
      const child = source[key];
      if (child !== undefined) result[key] = canonicalize(child);
    }
    return result;
  }
  return value;
}

export function reproducibilityPayload(manifest: ProductionManifest): string {
  const normalized = normalizeProductionManifest(manifest);
  const strictPayload = {
    format: normalized.format,
    formatVersion: normalized.formatVersion,
    projectId: normalized.projectId,
    projectRevision: normalized.projectRevision,
    projectStateSha256: normalized.projectStateSha256,
    storyIrVersion: normalized.storyIrVersion,
    storyIrSha256: normalized.storyIrSha256,
    sceneIds: normalized.sceneIds,
    shotIds: normalized.shotIds,
    assets: normalized.assets,
    models: normalized.models,
    engines: normalized.engines,
    recipes: normalized.recipes,
    approvedTakes: normalized.approvedTakes,
    unresolved: normalized.unresolved,
  };
  return JSON.stringify(canonicalize(strictPayload));
}

export async function webCryptoSha256(bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error("Web Crypto SHA-256 is unavailable in this runtime.");
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const digest = await subtle.digest("SHA-256", copy);
  return new Uint8Array(digest);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function digestProductionManifest(
  manifest: ProductionManifest,
  provider: DigestProvider = webCryptoSha256,
): Promise<ManifestDigest> {
  const assessment = assessReproducibility(manifest);
  if (assessment.status === "INVALID") {
    throw new Error("Cannot digest an invalid production manifest.");
  }
  const canonicalPayload = reproducibilityPayload(manifest);
  const digest = await provider(new TextEncoder().encode(canonicalPayload));
  if (digest.length !== 32) throw new Error("SHA-256 digest provider must return exactly 32 bytes.");
  return Object.freeze({ algorithm: "SHA-256", sha256: toHex(digest), canonicalPayload });
}

export function productionManifestEvidence(): readonly string[] {
  return Object.freeze([
    "The reproducibility digest covers exact content/model/engine/recipe/take dependencies and excludes evidence-only timestamps and device labels.",
    "A READY manifest means dependency identity is complete; it does not guarantee bit-identical GPU output across different drivers or hardware.",
    "Model binaries are referenced by stable id, version and SHA-256 and are not duplicated into the manifest.",
    "Missing media, model, engine or recipe dependencies remain explicit unresolved records instead of being silently substituted.",
  ]);
}
