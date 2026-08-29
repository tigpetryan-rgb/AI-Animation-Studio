import type { CapabilityPlan, PlatformTier } from "@aistudio/platform-capabilities";

export type ResourcePriority = "CRITICAL" | "INTERACTIVE" | "NORMAL" | "BACKGROUND";
export type ComputePreference = "CPU_ONLY" | "GPU_REQUIRED" | "GPU_PREFERRED" | "IO_ONLY";
export type ResourceQuality = "PROXY" | "PREVIEW" | "STANDARD" | "FINAL";
export type ExecutionLane = "CPU" | "GPU" | "IO";
export type AdmissionStatus = "ADMIT" | "DEFER" | "REJECT";

export interface ResourceRequest {
  readonly id: string;
  readonly priority: ResourcePriority;
  readonly compute: ComputePreference;
  readonly memoryMB: number;
  readonly scratchMB: number;
  readonly cpuSlots: number;
  readonly gpuSlots: number;
  readonly quality: ResourceQuality;
}

export interface ProducerPolicy {
  readonly reserveRatio?: number;
  readonly scratchBudgetMB?: number;
}

export interface ResourceBudget {
  readonly tier: PlatformTier;
  readonly memoryHardMB: number;
  readonly memoryWorkingMB: number;
  readonly memoryReserveMB: number;
  readonly scratchBudgetMB: number;
  readonly maxCpuSlots: number;
  readonly maxGpuSlots: number;
  readonly maxConcurrentJobs: number;
}

export type RequestValidationCode =
  | "EMPTY_ID"
  | "INVALID_MEMORY"
  | "INVALID_SCRATCH"
  | "INVALID_CPU_SLOTS"
  | "INVALID_GPU_SLOTS"
  | "INVALID_COMPUTE_SLOTS";

export type ProducerDecisionReason =
  | "ADMITTED"
  | "INVALID_REQUEST"
  | "DUPLICATE_REQUEST_ID"
  | "MEMORY_HARD_LIMIT"
  | "SCRATCH_HARD_LIMIT"
  | "CPU_CAPACITY_UNAVAILABLE"
  | "GPU_CAPACITY_UNAVAILABLE"
  | "NO_COMPUTE_LANE"
  | "WORKING_MEMORY_BUSY"
  | "SCRATCH_BUSY"
  | "CPU_BUSY"
  | "GPU_BUSY"
  | "CONCURRENCY_BUSY";

export interface AdmissionDecision {
  readonly requestId: string;
  readonly status: AdmissionStatus;
  readonly reason: ProducerDecisionReason;
  readonly lane?: ExecutionLane;
  readonly validation?: readonly RequestValidationCode[];
}

export interface ResourceUsage {
  readonly memoryMB: number;
  readonly scratchMB: number;
  readonly cpuSlots: number;
  readonly gpuSlots: number;
  readonly jobs: number;
}

export interface ProducerPlan {
  readonly budget: ResourceBudget;
  readonly decisions: readonly AdmissionDecision[];
  readonly admitted: readonly string[];
  readonly deferred: readonly string[];
  readonly rejected: readonly string[];
  readonly usage: ResourceUsage;
  readonly pressure: number;
  readonly previewQuality: ResourceQuality;
}

export interface ProducerBudgetEvidence {
  readonly source: "POLICY_DERIVED";
  readonly budget: ResourceBudget;
  readonly assumptions: readonly string[];
}

export interface ProducerQualityDecision {
  readonly requested: ResourceQuality;
  readonly recommended: ResourceQuality;
  readonly automatic: boolean;
}

const PRIORITY_RANK: Readonly<Record<ResourcePriority, number>> = Object.freeze({
  CRITICAL: 0,
  INTERACTIVE: 1,
  NORMAL: 2,
  BACKGROUND: 3,
});

function tierCpuSlots(tier: PlatformTier): number {
  switch (tier) {
    case "LITE": return 1;
    case "STANDARD": return 2;
    case "QUALITY": return 4;
    case "ULTRA": return 6;
  }
}

function tierConcurrentJobs(tier: PlatformTier): number {
  switch (tier) {
    case "LITE": return 1;
    case "STANDARD": return 2;
    case "QUALITY": return 3;
    case "ULTRA": return 4;
  }
}

function tierScratchBudgetMB(tier: PlatformTier): number {
  switch (tier) {
    case "LITE": return 512;
    case "STANDARD": return 1024;
    case "QUALITY": return 2048;
    case "ULTRA": return 4096;
  }
}

function clampReserveRatio(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0.2;
  return Math.max(0.1, Math.min(value, 0.5));
}

function positiveBudgetOverride(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

export function deriveProducerBudget(
  plan: CapabilityPlan,
  policy: ProducerPolicy = {},
): ResourceBudget {
  const memoryHardMB = Math.max(256, Math.floor(plan.memoryBudgetMB));
  const reserveRatio = clampReserveRatio(policy.reserveRatio);
  const desiredReserve = Math.max(128, Math.floor(memoryHardMB * reserveRatio));
  const memoryReserveMB = Math.min(desiredReserve, Math.max(0, memoryHardMB - 256));
  const memoryWorkingMB = Math.max(256, memoryHardMB - memoryReserveMB);
  const scratchBudgetMB = positiveBudgetOverride(policy.scratchBudgetMB, tierScratchBudgetMB(plan.tier));

  return Object.freeze({
    tier: plan.tier,
    memoryHardMB,
    memoryWorkingMB,
    memoryReserveMB,
    scratchBudgetMB,
    maxCpuSlots: tierCpuSlots(plan.tier),
    maxGpuSlots: plan.compute === "WEBGPU" ? 1 : 0,
    maxConcurrentJobs: tierConcurrentJobs(plan.tier),
  });
}

export function buildProducerBudgetEvidence(
  plan: CapabilityPlan,
  policy: ProducerPolicy = {},
): ProducerBudgetEvidence {
  return Object.freeze({
    source: "POLICY_DERIVED",
    budget: deriveProducerBudget(plan, policy),
    assumptions: Object.freeze([
      "Budget caps are conservative policy ceilings, not measurements of currently free RAM, VRAM or disk space.",
      "GPU concurrency is intentionally capped because browser capability probes do not expose reliable cross-platform VRAM capacity.",
      "Final-quality work is never silently downgraded by the producer budget layer.",
      "Representative device benchmarks remain separate from this scheduling policy.",
    ]),
  });
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export function validateResourceRequest(request: ResourceRequest): readonly RequestValidationCode[] {
  const issues: RequestValidationCode[] = [];
  if (request.id.trim().length === 0) issues.push("EMPTY_ID");
  if (!finiteNonNegative(request.memoryMB)) issues.push("INVALID_MEMORY");
  if (!finiteNonNegative(request.scratchMB)) issues.push("INVALID_SCRATCH");
  if (!nonNegativeInteger(request.cpuSlots)) issues.push("INVALID_CPU_SLOTS");
  if (!nonNegativeInteger(request.gpuSlots)) issues.push("INVALID_GPU_SLOTS");

  const slotShapeValid =
    (request.compute === "CPU_ONLY" && request.cpuSlots >= 1)
    || (request.compute === "GPU_REQUIRED" && request.gpuSlots >= 1)
    || (request.compute === "GPU_PREFERRED" && (request.cpuSlots >= 1 || request.gpuSlots >= 1))
    || request.compute === "IO_ONLY";
  if (!slotShapeValid) issues.push("INVALID_COMPUTE_SLOTS");

  return Object.freeze(issues);
}

function requestOrder(a: ResourceRequest, b: ResourceRequest): number {
  const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (priority !== 0) return priority;
  return a.id.localeCompare(b.id);
}

function hardRejectReason(request: ResourceRequest, budget: ResourceBudget): ProducerDecisionReason | undefined {
  if (request.memoryMB > budget.memoryHardMB) return "MEMORY_HARD_LIMIT";
  if (request.scratchMB > budget.scratchBudgetMB) return "SCRATCH_HARD_LIMIT";

  if (request.compute === "CPU_ONLY" && request.cpuSlots > budget.maxCpuSlots) {
    return "CPU_CAPACITY_UNAVAILABLE";
  }
  if (request.compute === "GPU_REQUIRED"
    && (budget.maxGpuSlots === 0 || request.gpuSlots > budget.maxGpuSlots)) {
    return "GPU_CAPACITY_UNAVAILABLE";
  }
  if (request.compute === "GPU_PREFERRED") {
    const cpuPossible = request.cpuSlots >= 1 && request.cpuSlots <= budget.maxCpuSlots;
    const gpuPossible = request.gpuSlots >= 1
      && budget.maxGpuSlots > 0
      && request.gpuSlots <= budget.maxGpuSlots;
    if (!cpuPossible && !gpuPossible) return "NO_COMPUTE_LANE";
  }
  return undefined;
}

function laneForRequest(
  request: ResourceRequest,
  budget: ResourceBudget,
  usage: ResourceUsage,
): ExecutionLane | undefined {
  if (request.compute === "IO_ONLY") return "IO";
  if (request.compute === "CPU_ONLY") {
    return usage.cpuSlots + request.cpuSlots <= budget.maxCpuSlots ? "CPU" : undefined;
  }
  if (request.compute === "GPU_REQUIRED") {
    return usage.gpuSlots + request.gpuSlots <= budget.maxGpuSlots ? "GPU" : undefined;
  }

  const gpuFits = request.gpuSlots >= 1
    && usage.gpuSlots + request.gpuSlots <= budget.maxGpuSlots;
  if (gpuFits) return "GPU";

  const cpuFits = request.cpuSlots >= 1
    && usage.cpuSlots + request.cpuSlots <= budget.maxCpuSlots;
  return cpuFits ? "CPU" : undefined;
}

function busyReason(
  request: ResourceRequest,
  budget: ResourceBudget,
  usage: ResourceUsage,
): ProducerDecisionReason {
  if (usage.jobs >= budget.maxConcurrentJobs) return "CONCURRENCY_BUSY";
  if (usage.memoryMB + request.memoryMB > budget.memoryWorkingMB) return "WORKING_MEMORY_BUSY";
  if (usage.scratchMB + request.scratchMB > budget.scratchBudgetMB) return "SCRATCH_BUSY";

  if (request.compute === "GPU_REQUIRED") return "GPU_BUSY";
  if (request.compute === "CPU_ONLY") return "CPU_BUSY";
  if (request.compute === "GPU_PREFERRED") {
    const gpuBlocked = request.gpuSlots < 1
      || usage.gpuSlots + request.gpuSlots > budget.maxGpuSlots;
    const cpuBlocked = request.cpuSlots < 1
      || usage.cpuSlots + request.cpuSlots > budget.maxCpuSlots;
    if (gpuBlocked && cpuBlocked) return budget.maxGpuSlots > 0 ? "GPU_BUSY" : "CPU_BUSY";
  }
  return "CONCURRENCY_BUSY";
}

function usageWith(request: ResourceRequest, lane: ExecutionLane, usage: ResourceUsage): ResourceUsage {
  return Object.freeze({
    memoryMB: usage.memoryMB + request.memoryMB,
    scratchMB: usage.scratchMB + request.scratchMB,
    cpuSlots: usage.cpuSlots + (lane === "CPU" ? request.cpuSlots : 0),
    gpuSlots: usage.gpuSlots + (lane === "GPU" ? request.gpuSlots : 0),
    jobs: usage.jobs + 1,
  });
}

export function resourcePressure(usage: ResourceUsage, budget: ResourceBudget): number {
  const ratios = [
    usage.memoryMB / Math.max(1, budget.memoryWorkingMB),
    usage.scratchMB / Math.max(1, budget.scratchBudgetMB),
    usage.cpuSlots / Math.max(1, budget.maxCpuSlots),
    usage.jobs / Math.max(1, budget.maxConcurrentJobs),
  ];
  if (budget.maxGpuSlots > 0) ratios.push(usage.gpuSlots / budget.maxGpuSlots);
  return Math.max(0, ...ratios);
}

export function recommendPreviewQuality(tier: PlatformTier, pressure: number): ResourceQuality {
  const normalizedPressure = Number.isFinite(pressure) ? Math.max(0, pressure) : 1;
  if (normalizedPressure >= 0.9) return "PROXY";
  if (normalizedPressure >= 0.7) return tier === "LITE" ? "PROXY" : "PREVIEW";
  if (tier === "LITE") return "PROXY";
  if (tier === "STANDARD") return "PREVIEW";
  return "STANDARD";
}

export function producerQualityDecision(
  requested: ResourceQuality,
  recommended: ResourceQuality,
): ProducerQualityDecision {
  if (requested === "FINAL" || requested === "STANDARD") {
    return Object.freeze({ requested, recommended: requested, automatic: false });
  }
  if (requested === "PREVIEW" && recommended === "PROXY") {
    return Object.freeze({ requested, recommended: "PROXY", automatic: true });
  }
  return Object.freeze({ requested, recommended: requested, automatic: false });
}

export function scheduleResourceBatch(
  requests: readonly ResourceRequest[],
  budget: ResourceBudget,
): ProducerPlan {
  const ordered = [...requests].sort(requestOrder);
  const decisions: AdmissionDecision[] = [];
  const admitted: string[] = [];
  const deferred: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  let usage: ResourceUsage = Object.freeze({ memoryMB: 0, scratchMB: 0, cpuSlots: 0, gpuSlots: 0, jobs: 0 });

  for (const request of ordered) {
    const validation = validateResourceRequest(request);
    if (validation.length > 0) {
      rejected.push(request.id);
      decisions.push(Object.freeze({
        requestId: request.id,
        status: "REJECT",
        reason: "INVALID_REQUEST",
        validation,
      }));
      continue;
    }

    if (seen.has(request.id)) {
      rejected.push(request.id);
      decisions.push(Object.freeze({
        requestId: request.id,
        status: "REJECT",
        reason: "DUPLICATE_REQUEST_ID",
      }));
      continue;
    }
    seen.add(request.id);

    const hardReason = hardRejectReason(request, budget);
    if (hardReason !== undefined) {
      rejected.push(request.id);
      decisions.push(Object.freeze({
        requestId: request.id,
        status: "REJECT",
        reason: hardReason,
      }));
      continue;
    }

    const lane = laneForRequest(request, budget, usage);
    const capacityFits = usage.jobs < budget.maxConcurrentJobs
      && usage.memoryMB + request.memoryMB <= budget.memoryWorkingMB
      && usage.scratchMB + request.scratchMB <= budget.scratchBudgetMB
      && lane !== undefined;

    if (!capacityFits) {
      deferred.push(request.id);
      decisions.push(Object.freeze({
        requestId: request.id,
        status: "DEFER",
        reason: busyReason(request, budget, usage),
      }));
      continue;
    }

    usage = usageWith(request, lane, usage);
    admitted.push(request.id);
    decisions.push(Object.freeze({
      requestId: request.id,
      status: "ADMIT",
      reason: "ADMITTED",
      lane,
    }));
  }

  const pressure = resourcePressure(usage, budget);
  return Object.freeze({
    budget,
    decisions: Object.freeze(decisions),
    admitted: Object.freeze(admitted),
    deferred: Object.freeze(deferred),
    rejected: Object.freeze(rejected),
    usage,
    pressure,
    previewQuality: recommendPreviewQuality(budget.tier, pressure),
  });
}
