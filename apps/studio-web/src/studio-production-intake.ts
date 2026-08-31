import { createStudioProject } from "@aistudio/core-project";
import { asProjectId } from "@aistudio/core-types";
import {
  advanceShotStage,
  createProductionRuntime,
  type ProductionRuntime,
} from "@aistudio/production-runtime";

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
}

interface Copy {
  readonly title: string;
  readonly planning: string;
  readonly waiting: string;
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
  readonly waitingDetail: string;
  readonly blockedDetail: string;
}

const COPY: Record<Locale, Copy> = {
  en: {
    title: "Studio production",
    planning: "Production started",
    waiting: "Waiting for scene setup",
    blocked: "Production needs input",
    stage: "Stage",
    intake: "Production intake",
    story: "Story / shot plan",
    references: "Reference media",
    blocking: "Scene blocking / character setup",
    acting: "Acting / animation",
    camera: "Camera",
    render: "Render",
    export: "MP4 export",
    pending: "Pending",
    complete: "Ready",
    noReferences: "No reference media attached",
    waitingDetail: "The job is registered in Studio's production runtime. Story intake is accepted; scene blocking and character/performance execution are not wired into this build yet, so Studio stops here instead of pretending to render.",
    blockedDetail: "The production runtime started, but a story prompt is required before scene blocking can begin.",
  },
  hy: {
    title: "Studio արտադրություն",
    planning: "Արտադրությունը սկսված է",
    waiting: "Սպասում է տեսարանի պատրաստմանը",
    blocked: "Արտադրությանը տվյալ է պետք",
    stage: "Փուլ",
    intake: "Աշխատանքի ընդունում",
    story: "Սցենար / կադրերի պլան",
    references: "Reference մեդիա",
    blocking: "Տեսարանի blocking / կերպարի պատրաստում",
    acting: "Դերասանական խաղ / անիմացիա",
    camera: "Տեսախցիկ",
    render: "Ռենդեր",
    export: "MP4 export",
    pending: "Սպասում է",
    complete: "Պատրաստ",
    noReferences: "Reference մեդիա կցված չէ",
    waitingDetail: "Աշխատանքը գրանցվել է Studio-ի production runtime-ում։ Սցենարի ընդունումը կատարված է, բայց տեսարանի blocking-ի և կերպարի/դերասանական կատարման executor-ները այս build-ում դեռ միացված չեն։ Studio-ն այստեղ կանգ է առնում և չի ցույց տալիս կեղծ render progress։",
    blockedDetail: "Production runtime-ը սկսվել է, բայց տեսարանի blocking-ին անցնելու համար պետք է սցենարային տեքստ։",
  },
  ru: {
    title: "Производство Studio",
    planning: "Производство запущено",
    waiting: "Ожидание подготовки сцены",
    blocked: "Нужны данные для производства",
    stage: "Этап",
    intake: "Приём задания",
    story: "Сценарий / план кадров",
    references: "Референсные материалы",
    blocking: "Блокинг сцены / подготовка персонажа",
    acting: "Актёрская игра / анимация",
    camera: "Камера",
    render: "Рендер",
    export: "Экспорт MP4",
    pending: "Ожидает",
    complete: "Готово",
    noReferences: "Референсные материалы не прикреплены",
    waitingDetail: "Задание зарегистрировано во внутреннем production runtime Studio. Сценарий принят, но исполнитель блокинга сцены и модуль персонажа/актёрской анимации в этой сборке ещё не подключены. Studio останавливается здесь и не показывает фиктивный прогресс рендера.",
    blockedDetail: "Production runtime запущен, но перед блокингом сцены нужен текст сценария.",
  },
};

const jobs = new Map<string, PersistedProductionJob>();
const runtimes = new Map<string, ProductionRuntime>();
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
      jobs.set(value.chatId, {
        chatId: value.chatId,
        projectId: value.projectId,
        shotId: value.shotId,
        prompt: value.prompt,
        referenceCount: value.referenceCount,
        status: value.status,
        stage: value.stage,
        startedAt: value.startedAt,
        updatedAt: value.updatedAt,
        diagnostics,
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
  title.textContent = job.status === "BLOCKED" ? strings.blocked : job.status === "WAITING_VALIDATION" ? strings.waiting : strings.planning;
  const stage = document.createElement("span");
  stage.dataset.runtimeProductionStage = "true";
  stage.textContent = `${strings.stage}: ${job.stage}`;
  head.append(title, stage);

  const message = document.createElement("div");
  message.dataset.runtimeProductionMessage = "true";
  message.textContent = job.status === "BLOCKED" ? strings.blockedDetail : strings.waitingDetail;

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
  appendStep(steps, strings.blocking, false, strings.pending);
  appendStep(steps, strings.acting, false, strings.pending);
  appendStep(steps, strings.camera, false, strings.pending);
  appendStep(steps, strings.render, false, strings.pending);
  appendStep(steps, strings.export, false, strings.pending);

  panel.append(head, message, steps);
  const diagnostic = job.diagnostics[0];
  if (diagnostic !== undefined) {
    const note = document.createElement("div");
    note.dataset.runtimeProductionDiagnostic = "true";
    note.textContent = diagnostic;
    panel.append(note);
  }
}

function startProduction(detail: ChatSubmitDetail): void {
  if (typeof detail.chatId !== "string") return;
  const chatId = detail.chatId;
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

  const result = advanceShotStage(runtime, shotId, "BLOCKED", {
    gates: [
      {
        kind: "STORY",
        passed: prompt.length > 0,
        hard: true,
        message: prompt.length > 0 ? "Story prompt accepted." : "Story prompt is required.",
      },
      {
        kind: "BLOCKING",
        passed: false,
        hard: false,
        message: "Scene blocking executor is not connected to runtime chat yet.",
      },
    ],
  });

  if (result.accepted) runtimes.set(chatId, result.runtime);
  const orchestrationStatus = result.orchestration?.status;
  const status: ProductionIntakeStatus = result.accepted
    ? "PLANNING"
    : orchestrationStatus === "BLOCKED"
      ? "BLOCKED"
      : "WAITING_VALIDATION";
  const diagnostics = result.accepted ? [] : result.diagnostics.map((item: { readonly message: string }) => item.message);
  const now = Date.now();
  const shot = result.runtime.shots[shotId];
  const job: PersistedProductionJob = {
    chatId,
    projectId,
    shotId,
    prompt,
    referenceCount: files.length,
    status,
    stage: shot?.stage ?? "PLANNED",
    startedAt: now,
    updatedAt: now,
    diagnostics,
  };
  jobs.set(chatId, job);
  persistJobs();
  render();
  window.dispatchEvent(new CustomEvent("aistudio:production-intake", { detail: job }));
}

function onSubmit(event: Event): void {
  const detail = (event as CustomEvent<ChatSubmitDetail>).detail;
  if (detail === null || typeof detail !== "object") return;
  try {
    startProduction(detail);
  } catch (error) {
    const chatId = typeof detail.chatId === "string" ? detail.chatId : activeChatId();
    if (chatId === null) return;
    const now = Date.now();
    jobs.set(chatId, {
      chatId,
      projectId: `runtime-${chatId}`,
      shotId: `shot-${chatId}`,
      prompt: typeof detail.prompt === "string" ? detail.prompt : "",
      referenceCount: Array.isArray(detail.files) ? detail.files.length : 0,
      status: "BLOCKED",
      stage: "PLANNED",
      startedAt: now,
      updatedAt: now,
      diagnostics: [error instanceof Error ? error.message : "Production intake failed."],
    });
    persistJobs();
    render();
  }
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
