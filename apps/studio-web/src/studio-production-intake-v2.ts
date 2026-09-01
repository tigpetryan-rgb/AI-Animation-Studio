import { createStudioProject } from "@aistudio/core-project";
import { asProjectId } from "@aistudio/core-types";
import { advanceShotStage, createProductionRuntime, type ProductionRuntime } from "@aistudio/production-runtime";
import { currentStudioBuildIdentity } from "./device-check";
import {
  executeActingPerformance,
  isActingPerformanceArtifact,
  isCharacterRigArtifact,
  prepareCharacterRig,
  type ActingPerformanceArtifact,
  type CharacterRigArtifact,
} from "./studio-character-performance";
import { isSceneBlockingArtifact, prepareSceneBlocking, type SceneBlockingArtifact } from "./studio-scene-blocking";

const CHAT_STORAGE_KEY = "aistudio.runtime.chat-state.v1";
const PRODUCTION_STORAGE_KEY = "aistudio.runtime.production-intake.v1";
type Status = "PLANNING" | "WAITING_VALIDATION" | "BLOCKED";

interface ChatSubmitDetail { readonly chatId?: unknown; readonly prompt?: unknown; readonly files?: unknown; }
export interface PersistedProductionJob {
  readonly chatId: string; readonly projectId: string; readonly shotId: string; readonly prompt: string;
  readonly referenceCount: number; readonly status: Status; readonly stage: string; readonly startedAt: number;
  readonly updatedAt: number; readonly diagnostics: readonly string[]; readonly blocking?: SceneBlockingArtifact;
  readonly rig?: CharacterRigArtifact; readonly acting?: ActingPerformanceArtifact;
}

const jobs = new Map<string, PersistedProductionJob>();
const runtimes = new Map<string, ProductionRuntime>();
const runVersionByChat = new Map<string, number>();
let installed = false;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function activeChatId(): string | null {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY); if (raw === null) return null;
    const value = JSON.parse(raw) as unknown;
    return record(value) && typeof value.activeChatId === "string" ? value.activeChatId : null;
  } catch { return null; }
}
function exactBuildCommit(): string { return currentStudioBuildIdentity().commit; }
function loadJobs(): void {
  try {
    const raw = localStorage.getItem(PRODUCTION_STORAGE_KEY); if (raw === null) return;
    const values = JSON.parse(raw) as unknown; if (!Array.isArray(values)) return;
    const commit = exactBuildCommit();
    for (const value of values) {
      if (!record(value) || typeof value.chatId !== "string" || typeof value.projectId !== "string" || typeof value.shotId !== "string") continue;
      if (typeof value.prompt !== "string" || typeof value.referenceCount !== "number" || typeof value.stage !== "string") continue;
      if (typeof value.startedAt !== "number" || typeof value.updatedAt !== "number") continue;
      if (value.status !== "PLANNING" && value.status !== "WAITING_VALIDATION" && value.status !== "BLOCKED") continue;
      const blocking = isSceneBlockingArtifact(value.blocking) ? value.blocking : undefined;
      const rig = isCharacterRigArtifact(value.rig, commit) ? value.rig : undefined;
      const acting = isActingPerformanceArtifact(value.acting, commit) ? value.acting : undefined;
      const diagnostics = Array.isArray(value.diagnostics) ? value.diagnostics.filter((item): item is string => typeof item === "string") : [];
      const mismatch = value.rig !== undefined && rig === undefined ? ["Stored character rig belongs to another Studio source commit."] : [];
      jobs.set(value.chatId, {
        chatId: value.chatId, projectId: value.projectId, shotId: value.shotId, prompt: value.prompt,
        referenceCount: value.referenceCount, status: value.status === "PLANNING" ? "BLOCKED" : value.status,
        stage: acting === undefined && value.stage === "PERFORMANCE_VALID" ? "REHEARSED" : value.stage,
        startedAt: value.startedAt, updatedAt: value.updatedAt, diagnostics: [...mismatch, ...diagnostics],
        ...(blocking === undefined ? {} : { blocking }), ...(rig === undefined ? {} : { rig }), ...(acting === undefined ? {} : { acting }),
      });
    }
  } catch { /* best effort */ }
}
function persistJobs(): void { try { localStorage.setItem(PRODUCTION_STORAGE_KEY, JSON.stringify([...jobs.values()])); } catch { /* best effort */ } }

function ensurePanel(): HTMLElement | null {
  const wrap = document.querySelector<HTMLElement>("[data-runtime-composer-wrap]"); if (wrap === null) return null;
  let panel = wrap.querySelector<HTMLElement>("[data-runtime-production-status]"); if (panel !== null) return panel;
  panel = document.createElement("section"); panel.dataset.runtimeProductionStatus = "true"; panel.dataset.visible = "false";
  panel.setAttribute("aria-live", "polite"); panel.setAttribute("aria-label", "Studio production status");
  const pending = wrap.querySelector("[data-runtime-pending-media]"); wrap.insertBefore(panel, pending); return panel;
}
function ensureStyles(): void {
  if (document.querySelector("style[data-runtime-production-intake-styles]") !== null) return;
  const style = document.createElement("style"); style.dataset.runtimeProductionIntakeStyles = "true";
  style.textContent = `[data-runtime-production-status]{display:none;width:min(100%,760px);margin:0 auto 8px;box-sizing:border-box;gap:8px;padding:10px 12px;border:1px solid #303640;border-radius:14px;background:#11141a;color:#eef1f5}[data-runtime-production-status][data-visible=true]{display:grid}[data-runtime-production-head]{display:flex;justify-content:space-between;gap:10px}[data-runtime-production-stage],[data-runtime-production-message],[data-runtime-production-step],[data-runtime-production-plan],[data-runtime-performance-plan],[data-runtime-production-diagnostic]{font-size:10px;line-height:1.4}[data-runtime-production-message],[data-runtime-production-plan],[data-runtime-performance-plan],[data-runtime-production-diagnostic]{color:#aeb6c2}[data-runtime-production-steps]{display:grid;gap:4px;margin:0;padding:0;list-style:none}[data-runtime-production-step]{display:grid;grid-template-columns:18px 1fr auto;gap:6px}[data-runtime-production-step][data-complete=true] [data-mark]{color:#dce5d4}`;
  document.head.append(style);
}
function addStep(list: HTMLElement, label: string, complete: boolean, state: string): void {
  const row = document.createElement("li"); row.dataset.runtimeProductionStep = "true"; row.dataset.complete = String(complete);
  const mark = document.createElement("span"); mark.dataset.mark = "true"; mark.textContent = complete ? "✓" : "○";
  const text = document.createElement("span"); text.textContent = label; const status = document.createElement("span"); status.textContent = state;
  row.append(mark, text, status); list.append(row);
}
function render(): void {
  ensureStyles(); const panel = ensurePanel(); if (panel === null) return;
  const id = activeChatId(); const job = id === null ? undefined : jobs.get(id); panel.replaceChildren();
  if (job === undefined) { panel.dataset.visible = "false"; return; }
  panel.dataset.visible = "true"; panel.dataset.status = job.status;
  const head = document.createElement("div"); head.dataset.runtimeProductionHead = "true";
  const title = document.createElement("strong"); title.textContent = job.status === "BLOCKED" ? "Production needs input" : job.acting !== undefined ? "Acting / animation ready" : job.blocking !== undefined ? "Scene blocking ready" : "Preparing scene blocking";
  const stage = document.createElement("span"); stage.dataset.runtimeProductionStage = "true"; stage.textContent = `Stage: ${job.stage}`; head.append(title, stage);
  const message = document.createElement("div"); message.dataset.runtimeProductionMessage = "true";
  message.textContent = job.acting !== undefined ? "Exact-source rig and real skeletal keyframe performance are valid. Camera, render and MP4 remain pending." : job.blocking !== undefined ? "Canonical rig/acting runs only from deterministic story actions; unparsed acting is never fabricated." : "Validating reference media and deterministic scene blocking.";
  const steps = document.createElement("ol"); steps.dataset.runtimeProductionSteps = "true";
  addStep(steps, "Production intake", true, "Ready"); addStep(steps, "Story / shot plan", job.prompt.trim().length > 0, job.prompt.trim().length > 0 ? "Ready" : "Pending");
  addStep(steps, "Reference media", job.referenceCount > 0, job.referenceCount > 0 ? `Ready · ${job.referenceCount}` : "No reference");
  addStep(steps, "Scene blocking / reference setup", job.blocking !== undefined, job.blocking === undefined ? "Pending" : "Ready");
  addStep(steps, "Acting / animation", job.acting !== undefined, job.acting === undefined ? "Pending" : "Ready");
  addStep(steps, "Camera", false, "Pending"); addStep(steps, "Render", false, "Pending"); addStep(steps, "MP4 export", false, "Pending");
  panel.append(head, message, steps);
  if (job.blocking !== undefined) {
    const plan = document.createElement("div"); plan.dataset.runtimeProductionPlan = "true"; const r = job.blocking.reference; const o = job.blocking.output;
    plan.textContent = `Blocking plan: ${r.name} · ${r.width}×${r.height} → ${o.width}×${o.height} · ${o.frameRate} fps · ${o.durationSeconds}s`; panel.append(plan);
  }
  if (job.acting !== undefined) {
    const performance = document.createElement("div"); performance.dataset.runtimePerformancePlan = "true"; performance.dataset.sourceCommit = job.acting.sourceCommit;
    performance.textContent = `Performance: ${job.acting.intents.map((item) => item.type).join(" + ")} · ${job.acting.payloads.length} keyframe tracks · ${job.acting.sourceCommit.slice(0, 12)}`; panel.append(performance);
  }
  if (job.diagnostics[0] !== undefined) { const note = document.createElement("div"); note.dataset.runtimeProductionDiagnostic = "true"; note.textContent = job.diagnostics[0]; panel.append(note); }
}
function storeJob(job: PersistedProductionJob): void {
  jobs.set(job.chatId, job); persistJobs(); render(); window.dispatchEvent(new CustomEvent("aistudio:production-intake", { detail: job }));
}
export function productionJobForChat(chatId: string): PersistedProductionJob | undefined { return jobs.get(chatId); }
export function productionRuntimeForChat(chatId: string): ProductionRuntime | undefined { return runtimes.get(chatId); }

function failJob(detail: ChatSubmitDetail, error: unknown): void {
  const chatId = typeof detail.chatId === "string" ? detail.chatId : activeChatId(); if (chatId === null) return;
  const previous = jobs.get(chatId); const now = Date.now();
  storeJob({
    chatId, projectId: previous?.projectId ?? `runtime-${chatId}`, shotId: previous?.shotId ?? `shot-${chatId}`,
    prompt: typeof detail.prompt === "string" ? detail.prompt : previous?.prompt ?? "", referenceCount: Array.isArray(detail.files) ? detail.files.length : previous?.referenceCount ?? 0,
    status: "BLOCKED", stage: previous?.stage ?? "PLANNED", startedAt: previous?.startedAt ?? now, updatedAt: now,
    diagnostics: [error instanceof Error ? error.message : "Production intake failed."],
    ...(previous?.blocking === undefined ? {} : { blocking: previous.blocking }), ...(previous?.rig === undefined ? {} : { rig: previous.rig }), ...(previous?.acting === undefined ? {} : { acting: previous.acting }),
  });
}

async function startProduction(detail: ChatSubmitDetail): Promise<void> {
  if (typeof detail.chatId !== "string") return; const chatId = detail.chatId; const version = (runVersionByChat.get(chatId) ?? 0) + 1; runVersionByChat.set(chatId, version);
  const prompt = typeof detail.prompt === "string" ? detail.prompt.trim() : ""; const files = Array.isArray(detail.files) ? detail.files.filter((item): item is File => item instanceof File) : [];
  const projectId = `runtime-${chatId}`; const shotId = `shot-${chatId}`; const startedAt = Date.now();
  const project = createStudioProject({ projectId: asProjectId(projectId), name: prompt.length > 0 ? prompt.slice(0, 80) : "Studio production" });
  const runtime = createProductionRuntime(project, [shotId]); runtimes.set(chatId, runtime);
  storeJob({ chatId, projectId, shotId, prompt, referenceCount: files.length, status: "PLANNING", stage: "PLANNED", startedAt, updatedAt: startedAt, diagnostics: ["Validating reference media and preparing scene blocking."] });
  const blockingResult = await prepareSceneBlocking({ chatId, prompt, files }); if (runVersionByChat.get(chatId) !== version) return;
  const toBlocked = advanceShotStage(runtime, shotId, "BLOCKED", { gates: [
    { kind: "STORY", passed: prompt.length > 0, hard: true, message: prompt.length > 0 ? "Story prompt accepted." : "Story prompt is required." },
    { kind: "BLOCKING", passed: blockingResult.ok, hard: true, message: blockingResult.ok ? "Deterministic scene blocking prepared." : blockingResult.diagnostics[0] ?? "Scene blocking failed." },
  ] });
  if (!toBlocked.accepted) {
    const shot = toBlocked.runtime.shots[shotId]; storeJob({ chatId, projectId, shotId, prompt, referenceCount: files.length, status: toBlocked.orchestration?.status === "BLOCKED" ? "BLOCKED" : "WAITING_VALIDATION", stage: shot?.stage ?? "PLANNED", startedAt, updatedAt: Date.now(), diagnostics: [...blockingResult.diagnostics, ...toBlocked.diagnostics.map((item) => item.message)] }); return;
  }
  if (blockingResult.artifact === undefined) {
    storeJob({ chatId, projectId, shotId, prompt, referenceCount: files.length, status: "BLOCKED", stage: "BLOCKED", startedAt, updatedAt: Date.now(), diagnostics: ["Scene blocking artifact is missing after a successful blocking gate."] }); return;
  }
  const blocking = blockingResult.artifact; runtimes.set(chatId, toBlocked.runtime);
  const rehearsed = advanceShotStage(toBlocked.runtime, shotId, "REHEARSED", { gates: [{ kind: "BLOCKING", passed: true, hard: true, message: "Blocking retained for rehearsal." }] });
  if (!rehearsed.accepted) { storeJob({ chatId, projectId, shotId, prompt, referenceCount: files.length, status: "WAITING_VALIDATION", stage: "BLOCKED", startedAt, updatedAt: Date.now(), diagnostics: rehearsed.diagnostics.map((item) => item.message), blocking }); return; }
  runtimes.set(chatId, rehearsed.runtime); const sourceCommit = exactBuildCommit(); const rigResult = prepareCharacterRig(blocking, shotId, sourceCommit);
  if (!rigResult.ok || rigResult.artifact === undefined) { storeJob({ chatId, projectId, shotId, prompt, referenceCount: files.length, status: "WAITING_VALIDATION", stage: "REHEARSED", startedAt, updatedAt: Date.now(), diagnostics: rigResult.diagnostics, blocking }); return; }
  const rig = rigResult.artifact; const actingResult = executeActingPerformance(blocking, rig, prompt, sourceCommit);
  if (!actingResult.ok || actingResult.artifact === undefined) { storeJob({ chatId, projectId, shotId, prompt, referenceCount: files.length, status: "WAITING_VALIDATION", stage: "REHEARSED", startedAt, updatedAt: Date.now(), diagnostics: [...actingResult.diagnostics, ...rigResult.diagnostics], blocking, rig }); return; }
  const acting = actingResult.artifact; const validated = advanceShotStage(rehearsed.runtime, shotId, "PERFORMANCE_VALID", { gates: [
    { kind: "PERFORMANCE", passed: actingResult.gates.performance, hard: true, message: "Skeletal performance/keyframes validated." },
    { kind: "CONTACT_IK", passed: actingResult.gates.contactIK, hard: true, message: "No unresolved contact/IK claim." },
    { kind: "PHYSICS", passed: actingResult.gates.physics, hard: true, message: "Bounded kinematic pose validation passed." },
  ] });
  if (!validated.accepted) { storeJob({ chatId, projectId, shotId, prompt, referenceCount: files.length, status: validated.orchestration?.status === "BLOCKED" ? "BLOCKED" : "WAITING_VALIDATION", stage: "REHEARSED", startedAt, updatedAt: Date.now(), diagnostics: [...validated.diagnostics.map((item) => item.message), ...actingResult.diagnostics], blocking, rig }); return; }
  runtimes.set(chatId, validated.runtime); storeJob({ chatId, projectId, shotId, prompt, referenceCount: files.length, status: "WAITING_VALIDATION", stage: "PERFORMANCE_VALID", startedAt, updatedAt: Date.now(), diagnostics: actingResult.diagnostics, blocking, rig, acting });
}

function onSubmit(event: Event): void { const detail = (event as CustomEvent<ChatSubmitDetail>).detail; if (detail !== null && typeof detail === "object") void startProduction(detail).catch((error) => failJob(detail, error)); }
function scheduleRender(): void { window.setTimeout(render, 0); }
export function installStudioProductionIntakeV2(): void {
  if (installed) return; installed = true; loadJobs(); ensureStyles(); window.addEventListener("aistudio:chat-submit", onSubmit); window.addEventListener("aistudio:runtime-ready", scheduleRender); window.addEventListener("aistudio:runtime-show-chat", scheduleRender);
  document.addEventListener("click", (event) => { const target = event.target instanceof Element ? event.target : null; if (target?.closest("[data-runtime-history-item], [data-runtime-nav-action=\"new-chat\"], [data-runtime-project-item]") !== null) scheduleRender(); }, true); scheduleRender();
}
installStudioProductionIntakeV2();
