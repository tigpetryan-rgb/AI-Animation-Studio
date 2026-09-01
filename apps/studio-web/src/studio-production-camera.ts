import { advanceShotStage, type ProductionRuntime } from "@aistudio/production-runtime";
import { currentStudioBuildIdentity } from "./device-check";
import {
  isCameraExecutionArtifact,
  prepareCameraExecution,
  type CameraExecutionArtifact,
} from "./studio-camera-executor";
import {
  productionJobForChat,
  productionRuntimeForChat,
  type PersistedProductionJob,
} from "./studio-production-intake-v2";

const CAMERA_STORAGE_KEY = "aistudio.runtime.camera-execution.v1";

interface PersistedCameraExecution {
  readonly chatId: string;
  readonly projectId: string;
  readonly shotId: string;
  readonly sourceCommit: string;
  readonly runtimeStage: "READY_FOR_RENDER";
  readonly artifact: CameraExecutionArtifact;
  readonly diagnostics: readonly string[];
  readonly updatedAt: number;
}

const executions = new Map<string, PersistedCameraExecution>();
const cameraRuntimes = new Map<string, ProductionRuntime>();
let installed = false;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactBuildCommit(): string {
  return currentStudioBuildIdentity().commit;
}

function loadExecutions(): void {
  try {
    const raw = localStorage.getItem(CAMERA_STORAGE_KEY);
    if (raw === null) return;
    const values = JSON.parse(raw) as unknown;
    if (!Array.isArray(values)) return;
    const commit = exactBuildCommit();
    for (const value of values) {
      if (!record(value) || typeof value.chatId !== "string" || typeof value.projectId !== "string" || typeof value.shotId !== "string") continue;
      if (typeof value.sourceCommit !== "string" || value.sourceCommit !== commit || value.runtimeStage !== "READY_FOR_RENDER") continue;
      if (typeof value.updatedAt !== "number" || !Array.isArray(value.diagnostics)) continue;
      if (!isCameraExecutionArtifact(value.artifact, commit)) continue;
      executions.set(value.chatId, {
        chatId: value.chatId,
        projectId: value.projectId,
        shotId: value.shotId,
        sourceCommit: value.sourceCommit,
        runtimeStage: "READY_FOR_RENDER",
        artifact: value.artifact,
        diagnostics: Object.freeze(value.diagnostics.filter((item): item is string => typeof item === "string")),
        updatedAt: value.updatedAt,
      });
    }
  } catch { /* best effort */ }
}

function persistExecutions(): void {
  try {
    localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify([...executions.values()]));
  } catch { /* best effort */ }
}

function activeChatId(): string | null {
  try {
    const raw = localStorage.getItem("aistudio.runtime.chat-state.v1");
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return record(parsed) && typeof parsed.activeChatId === "string" ? parsed.activeChatId : null;
  } catch { return null; }
}

function cameraStep(panel: HTMLElement): HTMLElement | null {
  const rows = [...panel.querySelectorAll<HTMLElement>("[data-runtime-production-step]")];
  return rows.find((row) => row.textContent?.includes("Camera") === true) ?? null;
}

function patchPanel(chatId: string): boolean {
  const execution = executions.get(chatId);
  if (execution === undefined) return false;
  const panel = document.querySelector<HTMLElement>("[data-runtime-production-status]");
  if (panel === null) return false;
  panel.dataset.cameraReady = "true";
  const heading = panel.querySelector<HTMLElement>("[data-runtime-production-head] strong");
  if (heading !== null) heading.textContent = "Camera ready for render";
  const stage = panel.querySelector<HTMLElement>("[data-runtime-production-stage]");
  if (stage !== null) stage.textContent = "Stage: READY_FOR_RENDER";
  const message = panel.querySelector<HTMLElement>("[data-runtime-production-message]");
  if (message !== null) message.textContent = "Acting and sampled camera-frustum visibility are valid on the exact source identity. Render and MP4 remain pending.";
  const row = cameraStep(panel);
  if (row !== null) {
    row.dataset.complete = "true";
    const spans = row.querySelectorAll<HTMLElement>("span");
    if (spans[0] !== undefined) spans[0].textContent = "✓";
    if (spans[2] !== undefined) spans[2].textContent = "Ready";
  }
  let plan = panel.querySelector<HTMLElement>("[data-runtime-camera-plan]");
  if (plan === null) {
    plan = document.createElement("div");
    plan.dataset.runtimeCameraPlan = "true";
    panel.append(plan);
  }
  plan.dataset.sourceCommit = execution.sourceCommit;
  plan.textContent = `Camera: ${execution.artifact.keyframes.length} keyframes · ${execution.artifact.visibilitySamples.length} frustum samples · exact continuity · ${execution.sourceCommit.slice(0, 12)}`;
  return true;
}

function storeExecution(execution: PersistedCameraExecution, runtime: ProductionRuntime): void {
  executions.set(execution.chatId, execution);
  cameraRuntimes.set(execution.chatId, runtime);
  persistExecutions();
  patchPanel(execution.chatId);
  window.dispatchEvent(new CustomEvent("aistudio:camera-ready", { detail: execution }));
}

function executeCamera(job: PersistedProductionJob): void {
  if (job.stage !== "PERFORMANCE_VALID" || job.blocking === undefined || job.rig === undefined || job.acting === undefined) return;
  const sourceCommit = exactBuildCommit();
  const existing = executions.get(job.chatId);
  if (existing !== undefined && existing.sourceCommit === sourceCommit && existing.shotId === job.shotId) {
    patchPanel(job.chatId);
    return;
  }
  const runtime = productionRuntimeForChat(job.chatId);
  if (runtime === undefined || runtime.shots[job.shotId]?.stage !== "PERFORMANCE_VALID") return;
  const result = prepareCameraExecution(job.blocking, job.rig, job.acting, sourceCommit);
  if (!result.ok || result.artifact === undefined) return;
  const advanced = advanceShotStage(runtime, job.shotId, "READY_FOR_RENDER", { gates: [
    { kind: "STORY", passed: job.prompt.trim().length > 0, hard: true, message: "Deterministic story IR retained." },
    { kind: "BLOCKING", passed: true, hard: true, message: "Scene blocking retained." },
    { kind: "PERFORMANCE", passed: true, hard: true, message: "Admitted PERFORMANCE_VALID skeletal performance retained." },
    { kind: "CONTACT_IK", passed: true, hard: true, message: "Admitted PERFORMANCE_VALID contact/IK gate retained." },
    { kind: "PHYSICS", passed: true, hard: true, message: "Admitted PERFORMANCE_VALID kinematic physics gate retained." },
    { kind: "CAMERA_VISIBILITY", passed: result.gates.cameraVisibility, hard: true, message: "Sampled camera frustum contains the full canonical actor bounds." },
    { kind: "CONTINUITY", passed: result.gates.continuity, hard: true, message: "Exact source/reference/actor identity continuity retained." },
  ] });
  if (!advanced.accepted) return;
  storeExecution(Object.freeze({
    chatId: job.chatId,
    projectId: job.projectId,
    shotId: job.shotId,
    sourceCommit,
    runtimeStage: "READY_FOR_RENDER",
    artifact: result.artifact,
    diagnostics: result.diagnostics,
    updatedAt: Date.now(),
  }), advanced.runtime);
}

function syncActive(): void {
  const chatId = activeChatId();
  if (chatId === null) return;
  const job = productionJobForChat(chatId);
  if (job !== undefined) executeCamera(job);
  if (!patchPanel(chatId)) window.setTimeout(() => patchPanel(chatId), 0);
}

function onProduction(event: Event): void {
  const detail = (event as CustomEvent<PersistedProductionJob>).detail;
  if (detail !== null && typeof detail === "object") executeCamera(detail);
}

export function cameraExecutionForChat(chatId: string): PersistedCameraExecution | undefined {
  return executions.get(chatId);
}

export function cameraRuntimeForChat(chatId: string): ProductionRuntime | undefined {
  return cameraRuntimes.get(chatId);
}

export function installStudioProductionCamera(): void {
  if (installed) return;
  installed = true;
  loadExecutions();
  window.addEventListener("aistudio:production-intake", onProduction);
  window.addEventListener("aistudio:runtime-show-chat", syncActive);
  window.addEventListener("aistudio:runtime-ready", syncActive);
  document.addEventListener("click", () => window.setTimeout(syncActive, 0), true);
  window.setTimeout(syncActive, 0);
}

installStudioProductionCamera();
