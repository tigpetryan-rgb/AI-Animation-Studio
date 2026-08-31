import { asCharacterId } from "@aistudio/core-types";
import type { BlockingPlan, StagePoint } from "@aistudio/performance-engine";

export interface SceneReferenceIdentity {
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
}

export interface SceneOutputSpec {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly durationSeconds: number;
}

export interface CameraBlockingDraft {
  readonly start: StagePoint;
  readonly end: StagePoint;
  readonly target: StagePoint;
  readonly framing: "MEDIUM_WIDE";
}

export interface SceneBlockingArtifact {
  readonly schemaVersion: 1;
  readonly actorId: string;
  readonly reference: SceneReferenceIdentity;
  readonly plan: BlockingPlan;
  readonly cameraDraft: CameraBlockingDraft;
  readonly output: SceneOutputSpec;
  readonly prompt: string;
  readonly preparedAt: number;
}

export interface SceneBlockingResult {
  readonly ok: boolean;
  readonly artifact?: SceneBlockingArtifact;
  readonly diagnostics: readonly string[];
}

interface SceneBlockingInput {
  readonly chatId: string;
  readonly prompt: string;
  readonly files: readonly File[];
}

function finitePositive(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function firstNumber(prompt: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(prompt);
  if (match?.[1] === undefined) return undefined;
  const parsed = Number.parseFloat(match[1].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function outputSpec(prompt: string): { readonly output: SceneOutputSpec; readonly diagnostics: readonly string[] } {
  const diagnostics: string[] = [];
  const resolution = /(\d{2,5})\s*[x×х]\s*(\d{2,5})/iu.exec(prompt);
  const width = resolution?.[1] === undefined ? 1920 : Number.parseInt(resolution[1], 10);
  const height = resolution?.[2] === undefined ? 1080 : Number.parseInt(resolution[2], 10);
  const frameRate = firstNumber(prompt, /(\d{1,3}(?:[.,]\d+)?)\s*(?:fps|կադր\s*\/\s*վրկ|кадр(?:ов)?\s*\/\s*с)/iu) ?? 24;
  const durationSeconds = firstNumber(
    prompt,
    /(\d{1,5}(?:[.,]\d+)?)\s*(?:seconds?|secs?|sec|վայրկյան(?:անոց)?|վրկ|секунд(?:а|ы)?|сек)/iu,
  ) ?? 10;

  if (!finitePositive(width, 64, 8192) || !finitePositive(height, 64, 8192)) {
    diagnostics.push("Requested output resolution must be between 64 and 8192 pixels per side.");
  }
  if (!finitePositive(frameRate, 1, 120)) {
    diagnostics.push("Requested frame rate must be between 1 and 120 fps.");
  }
  if (!finitePositive(durationSeconds, 0.1, 3600)) {
    diagnostics.push("Requested shot duration must be between 0.1 and 3600 seconds.");
  }

  return {
    output: { width, height, frameRate, durationSeconds },
    diagnostics,
  };
}

function imageFile(files: readonly File[]): File | undefined {
  return files.find((file) => file.type.startsWith("image/"));
}

async function inspectImage(file: File): Promise<SceneReferenceIdentity> {
  if (file.size <= 0) throw new Error("Character reference image is empty.");

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width <= 0 || bitmap.height <= 0) throw new Error("Character reference image has invalid dimensions.");
      return {
        name: file.name,
        mimeType: file.type || "image/*",
        size: file.size,
        width: bitmap.width,
        height: bitmap.height,
      };
    } finally {
      bitmap.close();
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const dimensions = await new Promise<{ readonly width: number; readonly height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("Character reference image could not be decoded."));
      image.src = url;
    });
    if (dimensions.width <= 0 || dimensions.height <= 0) throw new Error("Character reference image has invalid dimensions.");
    return {
      name: file.name,
      mimeType: file.type || "image/*",
      size: file.size,
      width: dimensions.width,
      height: dimensions.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function safeId(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 64) : "runtime-character";
}

function point(x: number, y: number, z: number): StagePoint {
  return Object.freeze({ x, y, z });
}

function blockingPlan(actorId: string): BlockingPlan {
  const id = asCharacterId(actorId);
  const actorOrigin = point(0, 0, 0);
  return Object.freeze({
    placements: Object.freeze([{ actorId: id, position: actorOrigin }]),
    paths: Object.freeze([{ actorId: id, points: Object.freeze([actorOrigin]) }]),
  });
}

function cameraDraft(): CameraBlockingDraft {
  return Object.freeze({
    start: point(0, 1.15, 3.8),
    end: point(0, 1.1, 2.4),
    target: point(0, 0.95, 0),
    framing: "MEDIUM_WIDE",
  });
}

export async function prepareSceneBlocking(input: SceneBlockingInput): Promise<SceneBlockingResult> {
  const diagnostics: string[] = [];
  if (input.prompt.trim().length === 0) diagnostics.push("A story/shot prompt is required before scene blocking.");

  const referenceFile = imageFile(input.files);
  if (referenceFile === undefined) {
    diagnostics.push("A character image reference is required before scene blocking; Studio will not fabricate a character identity.");
  }

  const parsedOutput = outputSpec(input.prompt);
  diagnostics.push(...parsedOutput.diagnostics);
  if (referenceFile === undefined || diagnostics.length > 0) return { ok: false, diagnostics: Object.freeze(diagnostics) };

  let reference: SceneReferenceIdentity;
  try {
    reference = await inspectImage(referenceFile);
  } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : "Character reference image could not be decoded.");
    return { ok: false, diagnostics: Object.freeze(diagnostics) };
  }

  const actorId = `character-${safeId(input.chatId)}`;
  const artifact: SceneBlockingArtifact = Object.freeze({
    schemaVersion: 1,
    actorId,
    reference: Object.freeze(reference),
    plan: blockingPlan(actorId),
    cameraDraft: cameraDraft(),
    output: Object.freeze(parsedOutput.output),
    prompt: input.prompt,
    preparedAt: Date.now(),
  });

  return {
    ok: true,
    artifact,
    diagnostics: Object.freeze([
      `Decoded reference ${reference.name} at ${reference.width}×${reference.height}.`,
      "Deterministic spatial blocking is ready; acting, rig deformation, camera execution, rendering and MP4 export remain separate downstream stages.",
    ]),
  };
}

function isPoint(value: unknown): value is StagePoint {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StagePoint>;
  return typeof candidate.x === "number" && Number.isFinite(candidate.x)
    && typeof candidate.y === "number" && Number.isFinite(candidate.y)
    && typeof candidate.z === "number" && Number.isFinite(candidate.z);
}

export function isSceneBlockingArtifact(value: unknown): value is SceneBlockingArtifact {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SceneBlockingArtifact>;
  const reference = candidate.reference as Partial<SceneReferenceIdentity> | undefined;
  const output = candidate.output as Partial<SceneOutputSpec> | undefined;
  const camera = candidate.cameraDraft as Partial<CameraBlockingDraft> | undefined;
  const plan = candidate.plan as Partial<BlockingPlan> | undefined;
  return candidate.schemaVersion === 1
    && typeof candidate.actorId === "string"
    && typeof candidate.prompt === "string"
    && typeof candidate.preparedAt === "number"
    && reference !== undefined
    && typeof reference.name === "string"
    && typeof reference.mimeType === "string"
    && typeof reference.size === "number"
    && typeof reference.width === "number"
    && typeof reference.height === "number"
    && output !== undefined
    && typeof output.width === "number"
    && typeof output.height === "number"
    && typeof output.frameRate === "number"
    && typeof output.durationSeconds === "number"
    && camera !== undefined
    && isPoint(camera.start)
    && isPoint(camera.end)
    && isPoint(camera.target)
    && camera.framing === "MEDIUM_WIDE"
    && plan !== undefined
    && Array.isArray(plan.placements)
    && Array.isArray(plan.paths);
}
