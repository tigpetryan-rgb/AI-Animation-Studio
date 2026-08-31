import { createStudioProject } from "@aistudio/core-project";
import { asProjectId } from "@aistudio/core-types";
import {
  advanceShotStage,
  createProductionRuntime,
  type ProductionRuntime,
} from "@aistudio/production-runtime";
import {
  isSceneBlockingArtifact,
  prepareSceneBlocking,
  type SceneBlockingArtifact,
} from "./studio-scene-blocking";

const CHAT_STORAGE_KEY = "aistudio.runtime.chat-state.v1";
const PRODUCTION_STORAGE_KEY = "aistudio.runtime.production-intake.v1";

type ProductionIntakeStatus = "PLANNING" | "WAITING_VALIDATION" | "BLOCKED";
type Locale = "en" | "hy" | "ru";

interface ChatSubmitDetail {
  readonly chatId?: unknown;
  readonly prompt?: unknown;
  readonly files?: unknown;
}

interface PersistedProductionJob {
  readonly chatId: string;
  readonly projectId: string;
  readonly shotId: string;
  readonly prompt: string;
  readonly referenceCount: number;
  readonly status: ProductionIntakeStatus;
  readonly stage: string;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly diagnostics: readonly string[];
  readonly blocking?: SceneBlockingArtifact;
}

interface Copy {
  readonly planning: string;
  readonly waitingBlocking: string;
  readonly waitingActing: string;
  readonly blocked: string;
  readonly stage: string;
  readonly intake: string;
  readonly story: string;
  readonly references: string;
  readonly blocking: string;
  readonly acting: string;
  readonly camera: string;
  readonly render: string;
  readonly export: string;
  readonly pending: string;
  readonly complete: string;
  readonly noReferences: string;
  readonly planningDetail: string;
  readonly blockingDetail: string;
  readonly actingDetail: string;
  readonly blockedDetail: string;
  readonly plan: string;
}

const COPY: Record<Locale, Copy> = {
  en: {
    planning: "Preparing scene blocking",
    waitingBlocking: "Waiting for scene setup",
    waitingActing: "Scene blocking ready",
    blocked: "Production needs input",
    stage: "Stage",
    intake: "Production intake",
    story: "Story / shot plan",
    references: "Reference media",
    blocking: "Scene blocking / reference setup",
    acting: "Acting / animation",
    camera: "Camera",
    render: "Render",
    export: "MP4 export",
    pending: "Pending",
    complete: "Ready",
    noReferences: "No reference media attached",
    planningDetail: "Studio is validating the attached image and preparing a deterministic spatial blocking plan.",
    blockingDetail: "The production runtime has the story, but scene blocking still needs a valid character image reference.",
    actingDetail: "The character reference was decoded and deterministic scene blocking is ready. The shot advanced to REHEARSED. Acting/animation is the next real executor; camera execution, render and MP4 export have not started.",
    blockedDetail: "Studio could not prepare a valid scene block from the supplied inputs. Fix the diagnostic below and submit again.",
    plan: "Blocking plan",
  },
  hy: {
    planning: "Պատրաստվում է տեսարանի blocking-ը",
    waitingBlocking: "Սպասում է տեսարանի պատրաստմանը",
    waitingActing: "Տեսարանի blocking-ը պատրաստ է",
    blocked: "Արտադրությանը տվյալ է պետք",
    stage: "Փուլ",
    intake: "Աշխատանքի ընդունում",
    story: "Սցենար / կադրերի պլան",
    references: "Reference մեդիա",
    blocking: "Տեսարանի blocking / reference պատրաստում",
    acting: "Դերասանական խաղ / անիմացիա",
    camera: "Տեսախցիկ",
    render: "Ռենդեր",
    export: "MP4 export",
    pending: "Սպասում է",
    complete: "Պատրաստ",
    noReferences: "Reference մեդիա կցված չէ",
    planningDetail: "Studio-ն ստուգում է կցված նկարը և պատրաստում deterministic տարածական blocking plan։",
    blockingDetail: "Սցենարը ընդունված է, բայց scene blocking-ի համար դեռ պետք է վավեր կերպարի նկար-reference։",
    actingDetail: "Կերպարի reference նկարը վավերացվել է և deterministic scene blocking-ը պատրաստ է։ Կադրը հասել է REHEARSED փուլին։ Հաջորդ իրական executor-ը դերասանական խաղ/անիմացիան է․ camera execution, render և MP4 export դեռ չեն սկսվել։",
    blockedDetail: "Studio-ն մուտքային տվյալներից վավեր scene blocking չկարողացավ պատրաստել։ Ուղղիր ներքևի diagnostic-ը և նորից ուղարկիր։",
    plan: "Blocking plan",
  },
  ru: {
    planning: "Подготовка блокинга сцены",
    waitingBlocking: "Ожидание подготовки сцены",
    waitingActing: "Блокинг сцены готов",
    blocked: "Нужны данные для производства",
    stage: "Этап",
    intake: "Приём задания",
    story: "Сценарий / план кадров",
    references: "Референсные материалы",
    blocking: "Блокинг сцены / подготовка референса",
    acting: "Актёрская игра / анимация",
    camera: "Камера",
    render: "Рендер",
    export: "Экспорт MP4",
    pending: "Ожидает",
    complete: "Готово",
    noReferences: "Референсные материалы не прикреплены",
    planningDetail: "Studio проверяет прикреплённое изображение и готовит детерминированный пространственный план блокинга.",
    blockingDetail: "Сценарий принят, но для блокинга сцены нужен корректный референс персонажа.",
    actingDetail: "Референс персонажа декодирован, детерминированный блокинг сцены готов, и кадр перешёл в REHEARSED. Следующий реальный исполнитель — актёрская игра/анимация; камера, рендер и MP4 ещё не запускались.",
    blockedDetail: "Studio не смогла подготовить корректный блокинг из входных данных. Исправьте diagnostic ниже и отправьте задание снова.",
    plan: "План блокинга",
  },
};

const jobs = new Map<string, PersistedProductionJob>();
const runtimes = new Map<string, ProductionRuntime>();
const runVersionByChat = new Map<string, number>();
let installed = false;

function locale(): Locale {
  const language = (navigator.languages?.[0] ?? navigator.language ?? "en").toLowerCase();
  if (language.startsWith("hy")) return "hy";
  if (language.startsWith("ru")) return "ru";
  return "en";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function activeChatId(): string | null {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || typeof parsed.activeChatId !== "string") return null;
    return parsed.activeChatId;
  } catch {
    return null;
  }
}

function loadJobs(): void {
  try {
    const raw = localStorage.getItem(PRODUCTION_STORAGE_KEY);
    if (raw === null) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const value of parsed) {
      if (!isRecord(value)) continue;
      if (typeof value.chatId !== "string" || typeof value.projectId !== "string" || typeof value.shotId !== "string") continue;
      if (typeof value.prompt !== "string" || typeof value.referenceCount !== "number") continue;
      if (value.status !== "PLANNING" && value.status !== "WAITING_VALIDATION" && value.status !== "BLOCKED") continue;
      if (typeof value.stage !== "string" || typeof value.startedAt !== "number" || typeof value.updatedAt !== "number") continue;
      const diagnostics = Array.isArray(value.diagnostics)
        ? value.diagnostics.filter((item): item is string => typeof item === "string")
        : [];
      const blocking = isSceneBlockingArtifact(value.blocking) ? value.blocking : undefined;
      const recoveredStatus: ProductionIntakeStatus = value.status === "PLANNING" ? "BLOCKED" : value.status;
      jobs.set(value.chatId, {
        chatId: value.chatId,
        projectId: value.projectId,
        shotId: value.shotId,
        prompt: value.prompt,
        referenceCount: value.referenceCount,
        status: recoveredStatus,
        stage: value.stage,
        startedAt: value.startedAt,
        updatedAt: value.updatedAt,
        diagnostics: value.status === "PLANNING" && blocking === undefined
          ? [...diagnostics, "Interrupted scene setup requires the reference media to be attached again."]
          : diagnostics,
        ...(blocking === undefined ? {} : { blocking }),
      });
    }
  } catch {
    // Production status persistence is best-effort and never blocks Studio startup.
  }
}

function persistJobs(): void {
  try {
    localStorage.setItem(PRODUCTION_STORAGE_KEY, JSON.stringify([...jobs.values()]));
  } catch {
    // The in-memory production runtime remains authoritative for the current session.
  }
}

function ensureStyles(): void {
  if (document.querySelector("style[data-runtime-production-intake-styles]") !== null) return;
  const style = document.createElement("style");
  style.dataset.runtimeProductionIntakeStyles = "true";
  style.textContent = `
    [data-runtime-production-status] {
      display: none;
      width: min(100%, 760px);
      margin: 0 auto 8px;
      box-sizing: border-box;
      gap: 9px;
      padding: 11px 13px;
      border: 1px solid #303640;
      border-radius: 14px;
      background: #11141a;
      color: #eef1f5;
    }
    [data-runtime-production-status][data-visible="true"] { display: grid; }
    [data-runtime-production-head] { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    [data-runtime-production-title] { font-size: 13px; font-weight: 700; }
    [data-runtime-production-stage] { color: #8f98a6; font-size: 10px; }
    [data-runtime-production-message] { color: #bac1cb; font-size: 11px; line-height: 1.45; }
    [data-runtime-production-steps] { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
    [data-runtime-production-step] { display: grid; grid-template-columns: 18px minmax(0,1fr) auto; gap: 6px; align-items: center; color: #cbd1d9; font-size: 10px; }
    [data-runtime-production-step] [data-mark] { text-align: center; color: #8e97a5; }
    [data-runtime-production-step][data-complete="true"] [data-mark] { color: #dce5d4; }
    [data-runtime-production-step] [data-state] { color: #707987; }
    [data-runtime-production-plan] { padding: 7px 9px; border: 1px solid #262c35; border-radius: 9px; color: #9fa8b5; font-size: 10px; line-height: 1.4; }
    [data-runtime-production-diagnostic] { color: #9da6b4; font-size: 10px; line-height: 1.4; }
  `;
  document.head.append(style);
}

function ensurePanel(): HTMLElement | null {
  ensureStyles();
  const wrap = document.querySelector<HTMLElement>("[data-runtime-composer-wrap]");
  if (wrap === null) return null;
  let panel = wrap.querySelector<HTMLElement>("[data-runtime-production-status]");
  if (panel !== null) return panel;
  panel = document.createElement("section");
  panel.dataset.runtimeProductionStatus = "true";
  panel.dataset.visible = "false";
  panel.setAttribute("aria-live", "polite");
  panel.setAttribute("aria-label", "Studio production status");
  const pending = wrap.querySelector("[data-runtime-pending-media]");
  wrap.insertBefore(panel, pending);
  return panel;
}

function appendStep(list: HTMLElement, label: string, complete: boolean, stateText: string): void {
  const row = document.createElement("li");
  row.dataset.runtimeProductionStep = "true";
  row.dataset.complete = String(complete);
  const mark = document.createElement("span");
  mark.dataset.mark = "true";
  mark.textContent = complete ? "✓" : "○";
  const text = document.createElement("span");
  text.textContent = label;
  const state = document.createElement("span");
  state.dataset.state = "true";
  state.textContent = stateText;
  row.append(mark, text, state);
  list.append(row);
}

function titleFor(job: PersistedProductionJob, strings: Copy): string {
  if (job.status === "BLOCKED") return strings.blocked;
  if (job.status === "PLANNING") return strings.planning;
  return job.blocking === undefined ? strings.waitingBlocking : strings.waitingActing;
}

function messageFor(job: PersistedProductionJob, strings: Copy): string {
  if (job.status === "BLOCKED") return strings.blockedDetail;
  if (job.status === "PLANNING") return strings.planningDetail;
  return job.blocking === undefined ? strings.blockingDetail : strings.actingDetail;
}

function render(): void {
  const panel = ensurePanel();
  if (panel === null) return;
  const chatId = activeChatId();
  const job = chatId === null ? undefined : jobs.get(chatId);
  panel.replaceChildren();
  if (job === undefined) {
    panel.dataset.visible = "false";
    delete panel.dataset.status;
    return;
  }

  const strings = COPY[locale()];
  panel.dataset.visible = "true";
  panel.dataset.status = job.status;
  const head = document.createElement("div");
  head.dataset.runtimeProductionHead = "true";
  const title = document.createElement("strong");
  title.dataset.runtimeProductionTitle = "true";
  title.textContent = titleFor(job, strings);
  const stage = document.createElement("span");
  stage.dataset.runtimeProductionStage = "true";
  stage.textContent = `${strings.stage}: ${job.stage}`;
  head.append(title, stage);

  const message = document.createElement("div");
  message.dataset.runtimeProductionMessage = "true";
  message.textContent = messageFor(job, strings);

  const steps = document.createElement("ol");
  steps.dataset.runtimeProductionSteps = "true";
  const hasStory = job.prompt.trim().length > 0;
  appendStep(steps, strings.intake, true, strings.complete);
  appendStep(steps, strings.story, hasStory, hasStory ? strings.complete : strings.pending);
  appendStep(
    steps,
    strings.references,
    job.referenceCount > 0,
    job.referenceCount > 0 ? `${strings.complete} · ${job.referenceCount}` : strings.noReferences,
  );
  appendStep(steps, strings.blocking, job.blocking !== undefined, job.blocking === undefined ? strings.pending : strings.complete);
  appendStep(steps, strings.acting, false, strings.pending);
  appendStep(steps, strings.camera, false, strings.pending);
  appendStep(steps, strings.render, false, strings.pending);
  appendStep(steps, strings.export, false, strings.pending);

  panel.append(head, message, steps);
  if (job.blocking !== undefined) {
    const plan = document.createElement("div");
    plan.dataset.runtimeProductionPlan = "true";
    const reference = job.blocking.reference;
    const output = job.blocking.output;
    plan.textContent = `${strings.plan}: ${reference.name} · ${reference.width}×${reference.height} → ${output.width}×${output.height} · ${output.frameRate} fps · ${output.durationSeconds}s`;
    panel.append(plan);
  }
  const diagnostic = job.diagnostics[0];
  if (diagnostic !== undefined) {
    const note = document.createElement("div");
    note.dataset.runtimeProductionDiagnostic = "true";
    note.textContent = diagnostic;
    panel.append(note);
  }
}

function storeJob(job: PersistedProductionJob): void {
  jobs.set(job.chatId, job);
  persistJobs();
  render();
  window.dispatchEvent(new CustomEvent("aistudio:production-intake", { detail: job }));
}

function failJob(detail: ChatSubmitDetail, error: unknown): void {
  const chatId = typeof detail.chatId === "string" ? detail.chatId : activeChatId();
  if (chatId === null) return;
  const previous = jobs.get(chatId);
  const now = Date.now();
  storeJob({
    chatId,
    projectId: previous?.projectId ?? `runtime-${chatId}`,
    shotId: previous?.shotId ?? `shot-${chatId}`,
    prompt: typeof detail.prompt === "string" ? detail.prompt : previous?.prompt ?? "",
    referenceCount: Array.isArray(detail.files) ? detail.files.length : previous?.referenceCount ?? 0,
    status: "BLOCKED",
    stage: previous?.stage ?? "PLANNED",
    startedAt: previous?.startedAt ?? now,
    updatedAt: now,
    diagnostics: [error instanceof Error ? error.message : "Production intake failed."],
    ...(previous?.blocking === undefined ? {} : { blocking: previous.blocking }),
  });
}

async function startProduction(detail: ChatSubmitDetail): Promise<void> {
  if (typeof detail.chatId !== "string") return;
  const chatId = detail.chatId;
  const version = (runVersionByChat.get(chatId) ?? 0) + 1;
  runVersionByChat.set(chatId, version);

  const prompt = typeof detail.prompt === "string" ? detail.prompt.trim() : "";
  const files = Array.isArray(detail.files) ? detail.files.filter((item): item is File => item instanceof File) : [];
  const projectId = `runtime-${chatId}`;
  const shotId = `shot-${chatId}`;
  const project = createStudioProject({
    projectId: asProjectId(projectId),
    name: prompt.length > 0 ? prompt.slice(0, 80) : "Studio production",
  });
  const runtime = createProductionRuntime(project, [shotId]);
  runtimes.set(chatId, runtime);

  const startedAt = Date.now();
  storeJob({
    chatId,
    projectId,
    shotId,
    prompt,
    referenceCount: files.length,
    status: "PLANNING",
    stage: "PLANNED",
    startedAt,
    updatedAt: startedAt,
    diagnostics: ["Validating reference media and preparing scene blocking."],
  });

  const blockingResult = await prepareSceneBlocking({ chatId, prompt, files });
  if (runVersionByChat.get(chatId) !== version) return;

  const toBlocked = advanceShotStage(runtime, shotId, "BLOCKED", {
    gates: [
      {
        kind: "STORY",
        passed: prompt.length > 0,
        hard: true,
        message: prompt.length > 0 ? "Story prompt accepted." : "Story prompt is required.",
      },
      {
        kind: "BLOCKING",
        passed: blockingResult.ok,
        hard: true,
        message: blockingResult.ok ? "Deterministic scene blocking prepared from validated reference media." : blockingResult.diagnostics[0] ?? "Scene blocking failed.",
      },
    ],
  });

  if (!toBlocked.accepted) {
    const orchestrationStatus = toBlocked.orchestration?.status;
    const shot = toBlocked.runtime.shots[shotId];
    storeJob({
      chatId,
      projectId,
      shotId,
      prompt,
      referenceCount: files.length,
      status: orchestrationStatus === "BLOCKED" ? "BLOCKED" : "WAITING_VALIDATION",
      stage: shot?.stage ?? "PLANNED",
      startedAt,
      updatedAt: Date.now(),
      diagnostics: [...blockingResult.diagnostics, ...toBlocked.diagnostics.map((item) => item.message)],
    });
    return;
  }

  runtimes.set(chatId, toBlocked.runtime);
  const toRehearsed = advanceShotStage(toBlocked.runtime, shotId, "REHEARSED", {
    gates: [{
      kind: "BLOCKING",
      passed: blockingResult.artifact !== undefined,
      hard: true,
      message: blockingResult.artifact === undefined ? "Scene blocking artifact is missing." : "Scene blocking artifact retained for rehearsal.",
    }],
  });

  if (!toRehearsed.accepted || blockingResult.artifact === undefined) {
    const shot = toRehearsed.runtime.shots[shotId];
    storeJob({
      chatId,
      projectId,
      shotId,
      prompt,
      referenceCount: files.length,
      status: toRehearsed.orchestration?.status === "BLOCKED" ? "BLOCKED" : "WAITING_VALIDATION",
      stage: shot?.stage ?? "BLOCKED",
      startedAt,
      updatedAt: Date.now(),
      diagnostics: toRehearsed.accepted ? ["Scene blocking artifact is missing."] : toRehearsed.diagnostics.map((item) => item.message),
    });
    return;
  }

  runtimes.set(chatId, toRehearsed.runtime);
  const shot = toRehearsed.runtime.shots[shotId];
  storeJob({
    chatId,
    projectId,
    shotId,
    prompt,
    referenceCount: files.length,
    status: "WAITING_VALIDATION",
    stage: shot?.stage ?? "REHEARSED",
    startedAt,
    updatedAt: Date.now(),
    diagnostics: blockingResult.diagnostics,
    blocking: blockingResult.artifact,
  });
}

function onSubmit(event: Event): void {
  const detail = (event as CustomEvent<ChatSubmitDetail>).detail;
  if (detail === null || typeof detail !== "object") return;
  void startProduction(detail).catch((error) => failJob(detail, error));
}

function scheduleRender(): void {
  window.setTimeout(render, 0);
}

export function installStudioProductionIntake(): void {
  if (installed) return;
  installed = true;
  loadJobs();
  ensureStyles();
  window.addEventListener("aistudio:chat-submit", onSubmit);
  window.addEventListener("aistudio:runtime-ready", scheduleRender);
  window.addEventListener("aistudio:runtime-show-chat", scheduleRender);
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-runtime-history-item], [data-runtime-nav-action=\"new-chat\"], [data-runtime-project-item]") !== null) {
      scheduleRender();
    }
  }, true);
  scheduleRender();
}

installStudioProductionIntake();
