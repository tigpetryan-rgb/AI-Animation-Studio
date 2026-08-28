import type { StudioCommand } from "@aistudio/core-events";

export type ModelTask =
  | "DIRECTOR_LLM"
  | "STORY_PARSE"
  | "IMAGE_GENERATION"
  | "IMAGE_EDIT"
  | "EMBEDDING"
  | "VISION"
  | "MOTION"
  | "TTS"
  | "SPEECH_RECOGNITION"
  | "LIP_SYNC";

export type ModelBackend = "WEBGPU" | "WASM_SIMD" | "WASM_CPU";
export type ModelQuantization = "FP32" | "FP16" | "INT8" | "INT4";
export type QualityTier = "LITE" | "STANDARD" | "QUALITY" | "ULTRA";

export interface ModelRef {
  readonly id: string;
  readonly version: string;
  readonly sha256: string;
  readonly task: ModelTask;
  readonly quantization: ModelQuantization;
  readonly estimatedRamMB: number;
  readonly supportedBackends: readonly ModelBackend[];
  readonly minimumTier: QualityTier;
  readonly licenseId: string;
}

export interface DeviceCapabilities {
  readonly webgpu: boolean;
  readonly wasm: boolean;
  readonly wasmSimd: boolean;
  readonly memoryBudgetMB: number;
  readonly tier: QualityTier;
}

export type ModelDiagnosticCode =
  | "AI_INVALID_MODEL"
  | "AI_DUPLICATE_MODEL_VERSION"
  | "AI_NO_COMPATIBLE_BACKEND"
  | "AI_MODEL_OVER_MEMORY_BUDGET"
  | "AI_NO_MODEL_FOR_TASK";

export interface ModelDiagnostic {
  readonly code: ModelDiagnosticCode;
  readonly message: string;
  readonly modelId?: string;
}

export interface ModelSelection {
  readonly model: ModelRef;
  readonly backend: ModelBackend;
}

const TIER_RANK: Readonly<Record<QualityTier, number>> = Object.freeze({
  LITE: 0,
  STANDARD: 1,
  QUALITY: 2,
  ULTRA: 3,
});

const BACKEND_PRIORITY: readonly ModelBackend[] = ["WEBGPU", "WASM_SIMD", "WASM_CPU"];

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

export function availableBackends(capabilities: DeviceCapabilities): readonly ModelBackend[] {
  const result: ModelBackend[] = [];
  if (capabilities.webgpu) result.push("WEBGPU");
  if (capabilities.wasm && capabilities.wasmSimd) result.push("WASM_SIMD");
  if (capabilities.wasm) result.push("WASM_CPU");
  return result;
}

export function validateModel(model: ModelRef): readonly ModelDiagnostic[] {
  const diagnostics: ModelDiagnostic[] = [];
  if (
    model.id.trim().length === 0
    || model.version.trim().length === 0
    || !isSha256(model.sha256)
    || !Number.isFinite(model.estimatedRamMB)
    || model.estimatedRamMB <= 0
    || model.supportedBackends.length === 0
  ) {
    diagnostics.push({ code: "AI_INVALID_MODEL", modelId: model.id, message: `Model ${model.id || "<empty>"} has invalid registry metadata.` });
  }
  return diagnostics;
}

export class ModelRegistry {
  private readonly entries = new Map<string, ModelRef>();

  register(model: ModelRef): readonly ModelDiagnostic[] {
    const validation = validateModel(model);
    if (validation.length > 0) return validation;
    const key = `${model.id}@${model.version}`;
    if (this.entries.has(key)) {
      return [{ code: "AI_DUPLICATE_MODEL_VERSION", modelId: model.id, message: `Model ${key} is already registered.` }];
    }
    this.entries.set(key, Object.freeze({ ...model, supportedBackends: Object.freeze([...model.supportedBackends]) }));
    return [];
  }

  list(task?: ModelTask): readonly ModelRef[] {
    return [...this.entries.values()]
      .filter((model) => task === undefined || model.task === task)
      .sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version));
  }

  get(id: string, version: string): ModelRef | undefined {
    return this.entries.get(`${id}@${version}`);
  }
}

function preferredBackend(model: ModelRef, device: DeviceCapabilities): ModelBackend | undefined {
  const available = new Set(availableBackends(device));
  const supported = new Set(model.supportedBackends);
  return BACKEND_PRIORITY.find((backend) => available.has(backend) && supported.has(backend));
}

export function selectModel(
  registry: ModelRegistry,
  task: ModelTask,
  device: DeviceCapabilities,
): { readonly selection?: ModelSelection; readonly diagnostics: readonly ModelDiagnostic[] } {
  const taskModels = registry.list(task);
  if (taskModels.length === 0) {
    return { diagnostics: [{ code: "AI_NO_MODEL_FOR_TASK", message: `No registered model for task ${task}.` }] };
  }

  const tierEligible = taskModels.filter((model) => TIER_RANK[device.tier] >= TIER_RANK[model.minimumTier]);
  const memoryEligible = tierEligible.filter((model) => model.estimatedRamMB <= device.memoryBudgetMB);
  if (memoryEligible.length === 0) {
    return { diagnostics: [{ code: "AI_MODEL_OVER_MEMORY_BUDGET", message: `No ${task} model fits the ${device.memoryBudgetMB} MB memory budget.` }] };
  }

  const compatible = memoryEligible
    .map((model) => ({ model, backend: preferredBackend(model, device) }))
    .filter((item): item is ModelSelection => item.backend !== undefined)
    .sort((a, b) => {
      const backendRank = BACKEND_PRIORITY.indexOf(a.backend) - BACKEND_PRIORITY.indexOf(b.backend);
      if (backendRank !== 0) return backendRank;
      const tierRank = TIER_RANK[b.model.minimumTier] - TIER_RANK[a.model.minimumTier];
      if (tierRank !== 0) return tierRank;
      const memory = a.model.estimatedRamMB - b.model.estimatedRamMB;
      if (memory !== 0) return memory;
      return a.model.id.localeCompare(b.model.id) || a.model.version.localeCompare(b.model.version);
    });

  const selection = compatible[0];
  if (selection === undefined) {
    return { diagnostics: [{ code: "AI_NO_COMPATIBLE_BACKEND", message: `No ${task} model supports an available local backend.` }] };
  }
  return { selection, diagnostics: [] };
}

export interface ModelAdapterCapabilities {
  readonly tasks: readonly ModelTask[];
  readonly backends: readonly ModelBackend[];
}

export interface ModelRunContext {
  readonly model: ModelRef;
  readonly backend: ModelBackend;
}

export interface ModelAdapter<Input = unknown, Output = unknown> {
  readonly adapterId: string;
  capabilities(): ModelAdapterCapabilities;
  load(context: ModelRunContext): Promise<void>;
  unload(): Promise<void>;
  run(input: Input, context: ModelRunContext): Promise<Output>;
}

export interface DecisionEvidence {
  readonly kind: "MODEL" | "RULE" | "REFERENCE";
  readonly description: string;
  readonly ref?: string;
}

export interface AgentProposal {
  readonly proposalId: string;
  readonly commands: readonly StudioCommand[];
  readonly confidence: number;
  readonly evidence: readonly DecisionEvidence[];
}

export function validateAgentProposal(proposal: AgentProposal): readonly ModelDiagnostic[] {
  if (
    proposal.proposalId.trim().length === 0
    || !Number.isFinite(proposal.confidence)
    || proposal.confidence < 0
    || proposal.confidence > 1
  ) {
    return [{ code: "AI_INVALID_MODEL", message: "Agent proposal metadata is invalid." }];
  }
  return [];
}
