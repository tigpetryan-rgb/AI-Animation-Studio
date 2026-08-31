const CHAT_STORAGE_KEY = "aistudio.runtime.chat-state.v1";
const GENERATION_STORAGE_KEY = "aistudio.runtime.generation-jobs.v1";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_JOB_AGE_MS = 15 * 60_000;
const MIN_POLL_INTERVAL_MS = 10;
const MAX_POLL_INTERVAL_MS = 10_000;

type GenerationStatus =
  | "SUBMITTING"
  | "QUEUED"
  | "RUNNING"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

interface GenerationConfig {
  readonly apiBaseUrl?: string;
  readonly requestTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly maxJobAgeMs?: number;
}

interface GenerationSubmitDetail {
  readonly chatId?: unknown;
  readonly prompt?: unknown;
  readonly files?: unknown;
}

interface GenerationResult {
  videoUrl: string;
  downloadUrl: string;
  mimeType: string;
  fileName: string;
}

interface GenerationJob {
  chatId: string;
  clientRequestId: string;
  prompt: string;
  status: GenerationStatus;
  startedAt: number;
  updatedAt: number;
  apiBaseUrl?: string;
  jobId?: string;
  progress?: number;
  message?: string;
  result?: GenerationResult;
  resultAnnounced?: boolean;
}

interface RetryInput {
  readonly prompt: string;
  readonly files: readonly File[];
}

interface BackendJobUpdate {
  readonly jobId?: string;
  readonly status: GenerationStatus;
  readonly progress?: number;
  readonly message?: string;
  readonly pollAfterMs?: number;
  readonly result?: GenerationResult;
}

declare global {
  interface Window {
    AIStudioGenerationConfig?: GenerationConfig;
  }
}

const jobsByChat = new Map<string, GenerationJob>();
const retryInputs = new Map<string, RetryInput>();
const pollingJobs = new Set<string>();
let installed = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function activeChatId(): string | null {
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || typeof parsed.activeChatId !== "string") return null;
    return parsed.activeChatId;
  } catch {
    return null;
  }
}

function normalizeApiBaseUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && !(url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost"))) {
      return null;
    }
    if (url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function currentConfig(): { apiBaseUrl: string | null; requestTimeoutMs: number; pollIntervalMs: number; maxJobAgeMs: number } {
  const config = window.AIStudioGenerationConfig;
  return {
    apiBaseUrl: normalizeApiBaseUrl(config?.apiBaseUrl),
    requestTimeoutMs: positiveNumber(config?.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
    pollIntervalMs: Math.min(
      MAX_POLL_INTERVAL_MS,
      Math.max(MIN_POLL_INTERVAL_MS, positiveNumber(config?.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS)),
    ),
    maxJobAgeMs: positiveNumber(config?.maxJobAgeMs, DEFAULT_MAX_JOB_AGE_MS),
  };
}

function loadPersistedJobs(): void {
  try {
    const raw = window.localStorage.getItem(GENERATION_STORAGE_KEY);
    if (raw === null) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const candidate of parsed) {
      if (!isRecord(candidate)) continue;
      if (typeof candidate.chatId !== "string" || typeof candidate.clientRequestId !== "string") continue;
      if (typeof candidate.prompt !== "string" || typeof candidate.startedAt !== "number" || typeof candidate.updatedAt !== "number") continue;
      if (!isGenerationStatus(candidate.status)) continue;
      const job: GenerationJob = {
        chatId: candidate.chatId,
        clientRequestId: candidate.clientRequestId,
        prompt: candidate.prompt,
        status: candidate.status,
        startedAt: candidate.startedAt,
        updatedAt: candidate.updatedAt,
      };
      if (typeof candidate.apiBaseUrl === "string") job.apiBaseUrl = candidate.apiBaseUrl;
      if (typeof candidate.jobId === "string") job.jobId = candidate.jobId;
      if (typeof candidate.progress === "number" && Number.isFinite(candidate.progress)) job.progress = candidate.progress;
      if (typeof candidate.message === "string") job.message = candidate.message;
      const result = parseResult(candidate.result, candidate.apiBaseUrl);
      if (result !== null) job.result = result;
      if (candidate.resultAnnounced === true) job.resultAnnounced = true;
      jobsByChat.set(job.chatId, job);
    }
  } catch {
    // Persisted generation status is best-effort and never blocks chat startup.
  }
}

function persistJobs(): void {
  try {
    window.localStorage.setItem(GENERATION_STORAGE_KEY, JSON.stringify([...jobsByChat.values()]));
  } catch {
    // Job polling remains usable even when local persistence is unavailable.
  }
}

function isGenerationStatus(value: unknown): value is GenerationStatus {
  return value === "SUBMITTING"
    || value === "QUEUED"
    || value === "RUNNING"
    || value === "PROCESSING"
    || value === "SUCCEEDED"
    || value === "FAILED"
    || value === "CANCELLED";
}

function backendStatus(value: unknown): GenerationStatus | null {
  if (typeof value !== "string") return null;
  switch (value.trim().toLowerCase()) {
    case "submitting": return "SUBMITTING";
    case "queued": return "QUEUED";
    case "running":
    case "generating": return "RUNNING";
    case "processing": return "PROCESSING";
    case "succeeded":
    case "success":
    case "completed": return "SUCCEEDED";
    case "failed":
    case "error": return "FAILED";
    case "cancelled":
    case "canceled": return "CANCELLED";
    default: return null;
  }
}

function parseProgress(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return undefined;
  return value;
}

function resolveBackendUrl(apiBaseUrl: unknown, value: unknown): string | null {
  if (typeof apiBaseUrl !== "string" || typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const resolved = new URL(value, `${apiBaseUrl.replace(/\/$/, "")}/`);
    if (resolved.protocol !== "https:" && !(resolved.protocol === "http:" && (resolved.hostname === "127.0.0.1" || resolved.hostname === "localhost"))) {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

function parseResult(value: unknown, apiBaseUrl: unknown): GenerationResult | null {
  if (!isRecord(value)) return null;
  const videoUrl = resolveBackendUrl(apiBaseUrl, value.videoUrl);
  if (videoUrl === null) return null;
  const downloadUrl = resolveBackendUrl(apiBaseUrl, value.downloadUrl) ?? videoUrl;
  const mimeType = typeof value.mimeType === "string" && value.mimeType.trim().length > 0 ? value.mimeType.trim() : "video/mp4";
  const fileName = typeof value.fileName === "string" && value.fileName.trim().length > 0 ? value.fileName.trim() : "generated-video.mp4";
  return { videoUrl, downloadUrl, mimeType, fileName };
}

function parseBackendUpdate(value: unknown, apiBaseUrl: string, requireJobId: boolean): BackendJobUpdate {
  if (!isRecord(value)) throw new Error("Generation service returned an invalid JSON object.");
  const status = backendStatus(value.status);
  if (status === null) throw new Error("Generation service returned an unsupported job status.");
  const jobId = typeof value.jobId === "string" && value.jobId.trim().length > 0 ? value.jobId.trim() : undefined;
  if (requireJobId && jobId === undefined) throw new Error("Generation service did not return a jobId.");
  const progress = parseProgress(value.progress);
  const message = typeof value.message === "string" && value.message.trim().length > 0 ? value.message.trim() : undefined;
  const pollAfterMs = typeof value.pollAfterMs === "number" && Number.isFinite(value.pollAfterMs) && value.pollAfterMs > 0
    ? Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, value.pollAfterMs))
    : undefined;
  const result = parseResult(value.result, apiBaseUrl) ?? undefined;
  if (status === "SUCCEEDED" && result === undefined) throw new Error("Generation service succeeded without a playable video result.");
  return {
    ...(jobId === undefined ? {} : { jobId }),
    status,
    ...(progress === undefined ? {} : { progress }),
    ...(message === undefined ? {} : { message }),
    ...(pollAfterMs === undefined ? {} : { pollAfterMs }),
    ...(result === undefined ? {} : { result }),
  };
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Generation service request timed out.");
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function responseError(response: Response): Promise<Error> {
  let message = `Generation service returned HTTP ${response.status}.`;
  try {
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = await response.json() as unknown;
      if (isRecord(body) && typeof body.message === "string" && body.message.trim().length > 0) message = body.message.trim();
    } else {
      const text = (await response.text()).trim();
      if (text.length > 0 && text.length <= 500) message = text;
    }
  } catch {
    // Preserve the HTTP status if the error body is unreadable.
  }
  return new Error(message);
}

async function fetchJson(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const response = await fetchWithTimeout(input, init, timeoutMs);
  if (!response.ok) throw await responseError(response);
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error("Generation service returned invalid JSON.");
  }
}

function statusLabel(status: GenerationStatus): string {
  switch (status) {
    case "SUBMITTING": return "Submitting generation…";
    case "QUEUED": return "Queued";
    case "RUNNING": return "Generating video…";
    case "PROCESSING": return "Processing result…";
    case "SUCCEEDED": return "Video ready";
    case "FAILED": return "Generation failed";
    case "CANCELLED": return "Generation cancelled";
  }
}

function isTerminal(status: GenerationStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}

function ensureStyles(): void {
  if (document.querySelector("style[data-runtime-generation-styles]") !== null) return;
  const style = document.createElement("style");
  style.dataset.runtimeGenerationStyles = "true";
  style.textContent = `
    [data-runtime-generation-status] {
      display: none;
      margin: 0 0 10px;
      padding: 12px 14px;
      border: 1px solid #2a2f38;
      border-radius: 14px;
      background: #11141a;
      color: #f5f6f8;
      gap: 8px;
    }
    [data-runtime-generation-status][data-visible="true"] { display: grid; }
    [data-runtime-generation-head] { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    [data-runtime-generation-label] { font-weight: 700; }
    [data-runtime-generation-progress] { width: 100%; }
    [data-runtime-generation-message] { color: #b8bec9; font-size: 13px; line-height: 1.4; }
    [data-runtime-generation-video] { width: 100%; max-height: 42vh; border-radius: 10px; background: #050607; }
    [data-runtime-generation-actions] { display: flex; flex-wrap: wrap; gap: 8px; }
    [data-runtime-generation-actions] button { min-height: 40px; padding: 8px 12px; border-radius: 10px; }
  `;
  document.head.append(style);
}

function ensurePanel(): HTMLElement | null {
  ensureStyles();
  const composerWrap = document.querySelector<HTMLElement>("[data-runtime-composer-wrap]");
  if (composerWrap === null) return null;
  let panel = composerWrap.querySelector<HTMLElement>("[data-runtime-generation-status]");
  if (panel !== null) return panel;
  panel = document.createElement("section");
  panel.dataset.runtimeGenerationStatus = "true";
  panel.dataset.visible = "false";
  panel.setAttribute("aria-live", "polite");
  panel.setAttribute("aria-label", "Video generation status");
  const pending = composerWrap.querySelector("[data-runtime-pending-media]");
  composerWrap.insertBefore(panel, pending);
  return panel;
}

function renderStatus(): void {
  const panel = ensurePanel();
  if (panel === null) return;
  const chatId = activeChatId();
  const job = chatId === null ? undefined : jobsByChat.get(chatId);
  panel.replaceChildren();
  if (job === undefined) {
    panel.dataset.visible = "false";
    delete panel.dataset.status;
    return;
  }
  panel.dataset.visible = "true";
  panel.dataset.status = job.status;

  const head = document.createElement("div");
  head.dataset.runtimeGenerationHead = "true";
  const label = document.createElement("span");
  label.dataset.runtimeGenerationLabel = "true";
  label.textContent = statusLabel(job.status);
  const jobId = document.createElement("span");
  jobId.dataset.runtimeGenerationJobId = "true";
  jobId.textContent = job.jobId ?? "";
  head.append(label, jobId);
  panel.append(head);

  if (job.progress !== undefined) {
    const progress = document.createElement("progress");
    progress.dataset.runtimeGenerationProgress = "true";
    progress.max = 100;
    progress.value = Math.round(job.progress * 100);
    progress.setAttribute("aria-label", `Generation progress ${Math.round(job.progress * 100)}%`);
    panel.append(progress);
  }

  if (job.message !== undefined) {
    const message = document.createElement("div");
    message.dataset.runtimeGenerationMessage = "true";
    message.textContent = job.message;
    panel.append(message);
  }

  if (job.status === "SUCCEEDED" && job.result !== undefined) {
    const video = document.createElement("video");
    video.dataset.runtimeGenerationVideo = "true";
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = job.result.videoUrl;
    panel.append(video);
  }

  const actions = document.createElement("div");
  actions.dataset.runtimeGenerationActions = "true";
  if (!isTerminal(job.status) && job.jobId !== undefined) {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.dataset.runtimeGenerationCancel = "true";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => { void cancelJob(job.chatId); });
    actions.append(cancel);
  }
  if (job.status === "FAILED") {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.dataset.runtimeGenerationRetry = "true";
    retry.textContent = retryInputs.has(job.chatId) ? "Retry" : "Reattach media to retry";
    retry.disabled = !retryInputs.has(job.chatId);
    retry.addEventListener("click", () => { void retryJob(job.chatId); });
    actions.append(retry);
  }
  if (job.status === "SUCCEEDED" && job.result !== undefined) {
    const save = document.createElement("button");
    save.type = "button";
    save.dataset.runtimeGenerationSave = "true";
    save.textContent = "Save video";
    save.addEventListener("click", () => { void saveResult(job.chatId); });
    actions.append(save);
  }
  if (actions.childElementCount > 0) panel.append(actions);
}

function updateJob(job: GenerationJob, update: BackendJobUpdate): void {
  job.status = update.status;
  job.updatedAt = Date.now();
  if (update.jobId !== undefined) job.jobId = update.jobId;
  if (update.progress === undefined) delete job.progress;
  else job.progress = update.progress;
  if (update.message === undefined) delete job.message;
  else job.message = update.message;
  if (update.result === undefined) delete job.result;
  else job.result = update.result;
  persistJobs();
  renderStatus();
  if (job.status === "SUCCEEDED") announceResult(job);
}

function failJob(job: GenerationJob, error: unknown): void {
  job.status = "FAILED";
  job.updatedAt = Date.now();
  delete job.progress;
  job.message = error instanceof Error ? error.message : "Video generation failed.";
  persistJobs();
  renderStatus();
}

function announceResult(job: GenerationJob): void {
  if (job.result === undefined || job.resultAnnounced === true) return;
  job.resultAnnounced = true;
  persistJobs();
  window.dispatchEvent(new CustomEvent("aistudio:chat-result", {
    detail: {
      chatId: job.chatId,
      text: "Video generation completed.",
      media: [{
        id: createId("generated-video"),
        name: job.result.fileName,
        type: job.result.mimeType,
        size: 0,
      }],
    },
  }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function pollJob(job: GenerationJob, initialDelayMs?: number): Promise<void> {
  if (job.jobId === undefined || job.apiBaseUrl === undefined || isTerminal(job.status)) return;
  const key = `${job.chatId}:${job.jobId}`;
  if (pollingJobs.has(key)) return;
  pollingJobs.add(key);
  try {
    let pollDelay = initialDelayMs ?? currentConfig().pollIntervalMs;
    while (!isTerminal(job.status)) {
      const config = currentConfig();
      if (Date.now() - job.startedAt > config.maxJobAgeMs) {
        failJob(job, new Error("Video generation timed out before the service returned a terminal result."));
        return;
      }
      await delay(pollDelay);
      if (isTerminal(job.status)) return;
      const payload = await fetchJson(
        `${job.apiBaseUrl}/v1/video-jobs/${encodeURIComponent(job.jobId)}`,
        { method: "GET", headers: { Accept: "application/json" } },
        config.requestTimeoutMs,
      );
      const update = parseBackendUpdate(payload, job.apiBaseUrl, false);
      updateJob(job, update);
      pollDelay = update.pollAfterMs ?? config.pollIntervalMs;
    }
  } catch (error) {
    if (!isTerminal(job.status)) failJob(job, error);
  } finally {
    pollingJobs.delete(key);
  }
}

async function startJob(chatId: string, prompt: string, files: readonly File[]): Promise<void> {
  const existing = jobsByChat.get(chatId);
  if (existing !== undefined && !isTerminal(existing.status)) {
    existing.message = "A generation is already in progress for this chat. Wait for it to finish or cancel it first.";
    existing.updatedAt = Date.now();
    persistJobs();
    renderStatus();
    return;
  }

  const now = Date.now();
  const job: GenerationJob = {
    chatId,
    clientRequestId: createId("generation"),
    prompt,
    status: "SUBMITTING",
    startedAt: now,
    updatedAt: now,
  };
  jobsByChat.set(chatId, job);
  retryInputs.set(chatId, { prompt, files: [...files] });
  persistJobs();
  renderStatus();

  const config = currentConfig();
  if (config.apiBaseUrl === null) {
    failJob(job, new Error("Video generation service is not configured in this build. Configure a trusted HTTPS generation backend; provider credentials must remain server-side."));
    return;
  }
  job.apiBaseUrl = config.apiBaseUrl;
  persistJobs();

  const body = new FormData();
  body.append("chatId", chatId);
  body.append("clientRequestId", job.clientRequestId);
  body.append("prompt", prompt);
  for (const file of files) body.append("reference", file, file.name);

  try {
    const payload = await fetchJson(
      `${config.apiBaseUrl}/v1/video-jobs`,
      { method: "POST", headers: { Accept: "application/json" }, body },
      config.requestTimeoutMs,
    );
    const update = parseBackendUpdate(payload, config.apiBaseUrl, true);
    updateJob(job, update);
    if (!isTerminal(job.status)) void pollJob(job, update.pollAfterMs);
  } catch (error) {
    failJob(job, error);
  }
}

async function retryJob(chatId: string): Promise<void> {
  const input = retryInputs.get(chatId);
  if (input === undefined) return;
  await startJob(chatId, input.prompt, input.files);
}

async function cancelJob(chatId: string): Promise<void> {
  const job = jobsByChat.get(chatId);
  if (job === undefined || job.jobId === undefined || job.apiBaseUrl === undefined || isTerminal(job.status)) return;
  try {
    const config = currentConfig();
    const response = await fetchWithTimeout(
      `${job.apiBaseUrl}/v1/video-jobs/${encodeURIComponent(job.jobId)}/cancel`,
      { method: "POST", headers: { Accept: "application/json" } },
      config.requestTimeoutMs,
    );
    if (!response.ok) throw await responseError(response);
    job.status = "CANCELLED";
    job.updatedAt = Date.now();
    delete job.progress;
    job.message = "Generation cancelled.";
    persistJobs();
    renderStatus();
  } catch (error) {
    job.message = error instanceof Error ? error.message : "Unable to cancel generation.";
    job.updatedAt = Date.now();
    persistJobs();
    renderStatus();
  }
}

async function saveResult(chatId: string): Promise<void> {
  const job = jobsByChat.get(chatId);
  if (job?.result === undefined) return;
  try {
    const config = currentConfig();
    const response = await fetchWithTimeout(job.result.downloadUrl, { method: "GET" }, config.requestTimeoutMs);
    if (!response.ok) throw await responseError(response);
    const blob = await response.blob();
    const runtime = window.AIStudioRuntime;
    if (runtime !== undefined && typeof runtime.saveBlob === "function") {
      const saved = await runtime.saveBlob(job.result.fileName, job.result.mimeType || blob.type || "video/mp4", blob);
      job.message = `Saved ${saved.bytesWritten} bytes to the controlled Android Runtime.`;
    } else {
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = job.result.fileName;
        anchor.click();
        job.message = "Download started.";
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    }
    job.updatedAt = Date.now();
    persistJobs();
    renderStatus();
  } catch (error) {
    job.message = error instanceof Error ? `Save failed: ${error.message}` : "Save failed.";
    job.updatedAt = Date.now();
    persistJobs();
    renderStatus();
  }
}

function handleSubmit(event: Event): void {
  const detail = (event as CustomEvent<GenerationSubmitDetail>).detail;
  if (detail === null || typeof detail !== "object") return;
  if (typeof detail.chatId !== "string" || detail.chatId.trim().length === 0) return;
  const prompt = typeof detail.prompt === "string" ? detail.prompt.trim() : "";
  const files = Array.isArray(detail.files) ? detail.files.filter((candidate): candidate is File => candidate instanceof File) : [];
  if (prompt.length === 0 && files.length === 0) return;
  void startJob(detail.chatId, prompt, files);
}

function resumeJobs(): void {
  for (const job of jobsByChat.values()) {
    if (isTerminal(job.status)) {
      if (job.status === "SUCCEEDED") announceResult(job);
      continue;
    }
    if (job.jobId === undefined || job.apiBaseUrl === undefined) {
      failJob(job, new Error("Generation upload was interrupted before a resumable job id was received. Reattach the reference media and retry."));
      continue;
    }
    void pollJob(job);
  }
  renderStatus();
}

function syncAfterChatNavigation(event: Event): void {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("[data-runtime-history-item], [data-runtime-nav-action=\"new-chat\"], [data-runtime-project-item]") === null) return;
  window.setTimeout(renderStatus, 0);
}

export function installStudioGenerationIntegration(): void {
  if (installed) return;
  installed = true;
  loadPersistedJobs();
  window.addEventListener("aistudio:chat-submit", handleSubmit);
  window.addEventListener("aistudio:runtime-ready", () => {
    renderStatus();
    resumeJobs();
  });
  window.addEventListener("aistudio:generation-config-ready", () => renderStatus());
  document.addEventListener("click", syncAfterChatNavigation);
  renderStatus();
  resumeJobs();
}

installStudioGenerationIntegration();

export {};
