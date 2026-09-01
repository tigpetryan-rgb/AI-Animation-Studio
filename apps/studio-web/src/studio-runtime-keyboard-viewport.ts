declare global {
  interface Window {
    AIStudioKeyboardViewport?: {
      apply: (height: number, offsetTop?: number) => void;
      sync: () => void;
    };
  }
}

let installed = false;
let focusTimer: number | null = null;

function ensureStyles(): void {
  if (document.querySelector("style[data-runtime-keyboard-viewport-styles]") !== null) return;
  const style = document.createElement("style");
  style.dataset.runtimeKeyboardViewportStyles = "true";
  style.textContent = `
    html.runtime-simple-ui [data-runtime-chat-shell] {
      inset: auto 0 auto 0 !important;
      top: var(--runtime-visual-viewport-top, 0px) !important;
      height: var(--runtime-visual-viewport-height, 100dvh) !important;
      max-height: var(--runtime-visual-viewport-height, 100dvh) !important;
    }
    html.runtime-simple-ui[data-runtime-keyboard-open="true"] [data-runtime-composer-wrap] {
      padding-bottom: max(6px, env(safe-area-inset-bottom)) !important;
    }
  `;
  document.head.append(style);
}

export function applyRuntimeVisualViewport(height: number, offsetTop = 0): void {
  ensureStyles();
  const safeHeight = Math.max(1, Math.round(height * 100) / 100);
  const safeTop = Math.max(0, Math.round(offsetTop * 100) / 100);
  document.documentElement.style.setProperty("--runtime-visual-viewport-height", `${safeHeight}px`);
  document.documentElement.style.setProperty("--runtime-visual-viewport-top", `${safeTop}px`);
  const obscured = Math.max(0, window.innerHeight - (safeTop + safeHeight));
  document.documentElement.dataset.runtimeKeyboardOpen = String(obscured > 96);
}

export function syncRuntimeKeyboardViewport(): void {
  const viewport = window.visualViewport;
  applyRuntimeVisualViewport(viewport?.height ?? window.innerHeight, viewport?.offsetTop ?? 0);
}

function scheduleAfterKeyboardAnimation(): void {
  if (focusTimer !== null) window.clearTimeout(focusTimer);
  syncRuntimeKeyboardViewport();
  focusTimer = window.setTimeout(() => {
    focusTimer = null;
    syncRuntimeKeyboardViewport();
    const prompt = document.querySelector<HTMLTextAreaElement>("[data-runtime-prompt]:focus");
    prompt?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, 220);
}

export function installRuntimeKeyboardViewport(): void {
  if (installed) return;
  installed = true;
  ensureStyles();
  window.addEventListener("resize", syncRuntimeKeyboardViewport, { passive: true });
  window.visualViewport?.addEventListener("resize", syncRuntimeKeyboardViewport, { passive: true });
  window.visualViewport?.addEventListener("scroll", syncRuntimeKeyboardViewport, { passive: true });
  document.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) scheduleAfterKeyboardAnimation();
  });
  document.addEventListener("focusout", scheduleAfterKeyboardAnimation);
  window.addEventListener("aistudio:runtime-ready", syncRuntimeKeyboardViewport);
  window.AIStudioKeyboardViewport = { apply: applyRuntimeVisualViewport, sync: syncRuntimeKeyboardViewport };
  syncRuntimeKeyboardViewport();
}

installRuntimeKeyboardViewport();
