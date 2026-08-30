const SIMPLE_CLASS = "runtime-simple-ui";
const ADVANCED_CLASS = "runtime-advanced-ui";

let advancedVisible = false;
let syncQueued = false;

function currentProjectOpen(): boolean {
  const value = document.querySelector<HTMLElement>(".assets-panel > h2 + p")?.textContent?.trim() ?? "";
  return value.length > 0 && value !== "No project open";
}

function ensureSimpleStyles(): void {
  if (document.querySelector("style[data-runtime-simple-ui-styles]") !== null) return;

  const style = document.createElement("style");
  style.dataset.runtimeSimpleUiStyles = "true";
  style.textContent = `
    [data-runtime-simple-menu] {
      min-width: 44px;
      min-height: 44px;
      border: 1px solid #2b3240;
      border-radius: 999px;
      background: #171b23;
      color: #eef1f5;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
    }

    html.${SIMPLE_CLASS} body {
      background: #07080b;
    }

    html.${SIMPLE_CLASS} .studio-frame {
      display: block;
      min-height: 100vh;
      background: #07080b;
    }

    html.${SIMPLE_CLASS} .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      min-height: 70px;
      padding: 12px 18px;
      display: grid;
      grid-template-columns: 44px 1fr 44px;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid #171a21;
      background: rgba(7, 8, 11, .96);
      backdrop-filter: blur(18px);
    }

    html.${SIMPLE_CLASS} .topbar::before {
      content: "";
      width: 44px;
      height: 44px;
    }

    html.${SIMPLE_CLASS} .brand {
      display: block;
      text-align: center;
    }

    html.${SIMPLE_CLASS} .brand strong {
      font-size: 17px;
      font-weight: 600;
    }

    html.${SIMPLE_CLASS} .brand span,
    html.${SIMPLE_CLASS} .capability-banner,
    html.${SIMPLE_CLASS} .workspace-nav,
    html.${SIMPLE_CLASS} .inspector {
      display: none !important;
    }

    html.${SIMPLE_CLASS} .studio-body {
      display: block;
      min-height: 0;
    }

    html.${SIMPLE_CLASS} .panel {
      background: transparent;
    }

    html.${SIMPLE_CLASS} .assets-panel {
      border: 0;
      padding: 22px 20px 30px;
    }

    html.${SIMPLE_CLASS} .assets-panel > h2,
    html.${SIMPLE_CLASS} .assets-panel > h2 + p,
    html.${SIMPLE_CLASS} .assets-panel > button.primary:disabled,
    html.${SIMPLE_CLASS} .project-file-controls h3,
    html.${SIMPLE_CLASS} .project-file-controls [data-relink-asset-select],
    html.${SIMPLE_CLASS} .project-file-controls [data-relink-media-button],
    html.${SIMPLE_CLASS} .project-file-controls [data-project-file-status],
    html.${SIMPLE_CLASS} .studio-export-panel > h3,
    html.${SIMPLE_CLASS} .export-settings-grid,
    html.${SIMPLE_CLASS} [data-export-plan-summary],
    html.${SIMPLE_CLASS} [data-export-capability-summary] {
      display: none !important;
    }

    html.${SIMPLE_CLASS} .project-file-controls {
      display: grid;
      gap: 10px;
      margin-top: 10px;
    }

    html.${SIMPLE_CLASS} .project-file-controls [data-open-aistudio-button] {
      width: 100%;
      min-height: 50px;
      border-radius: 16px;
      background: transparent;
      color: #aeb6c4;
    }

    html.${SIMPLE_CLASS} .studio-export-panel {
      gap: 10px;
      margin-top: 10px;
    }

    html.${SIMPLE_CLASS} .studio-export-panel [data-export-mp4-button],
    html.${SIMPLE_CLASS} .studio-export-panel [data-save-aistudio-button] {
      width: 100%;
      min-height: 54px;
      border-radius: 16px;
      font-size: 16px;
    }

    html.${SIMPLE_CLASS} .studio-export-panel [data-export-mp4-status] {
      margin: 4px 0 0;
      font-size: 11px;
      line-height: 1.45;
      text-align: center;
    }

    html.${SIMPLE_CLASS} .studio-export-panel progress {
      height: 5px;
      border-radius: 999px;
    }

    html.${SIMPLE_CLASS}[data-runtime-project-open="false"] .viewport,
    html.${SIMPLE_CLASS}[data-runtime-project-open="false"] .timeline,
    html.${SIMPLE_CLASS}[data-runtime-project-open="false"] .studio-export-panel {
      display: none !important;
    }

    html.${SIMPLE_CLASS}[data-runtime-project-open="false"] .assets-panel {
      min-height: calc(100vh - 70px);
      max-width: 620px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 40px 24px 70px;
    }

    html.${SIMPLE_CLASS}[data-runtime-project-open="false"] .assets-panel > button.primary {
      width: 100%;
      min-height: 62px;
      margin-top: 28px;
      border-radius: 20px;
      font-size: 18px;
      font-weight: 600;
    }

    html.${SIMPLE_CLASS}[data-runtime-project-open="false"] .project-file-controls {
      margin-top: 12px;
    }

    html.${SIMPLE_CLASS}[data-runtime-project-open="true"] [data-runtime-simple-welcome] {
      display: none !important;
    }

    html.${SIMPLE_CLASS}[data-runtime-project-open="true"] .viewport {
      min-height: auto;
      padding: 22px 18px 12px;
      background: radial-gradient(circle at 50% 0%, #111721 0, #07080b 62%);
    }

    html.${SIMPLE_CLASS}[data-runtime-project-open="true"] .viewport > .eyebrow,
    html.${SIMPLE_CLASS}[data-runtime-project-open="true"] .viewport > h1,
    html.${SIMPLE_CLASS}[data-runtime-project-open="true"] .viewport > p.muted {
      display: none !important;
    }

    html.${SIMPLE_CLASS}[data-runtime-project-open="true"] .stage-placeholder {
      height: min(42vh, 430px);
      margin-top: 0;
      border-radius: 18px;
      border-color: #232936;
      background: #0c0f14;
    }

    html.${SIMPLE_CLASS}[data-runtime-project-open="true"] .assets-panel {
      max-width: 720px;
      margin: 0 auto;
    }

    html.${SIMPLE_CLASS}[data-runtime-project-open="true"] .timeline {
      min-height: 0;
      padding: 12px 16px 24px;
      border-top: 0;
      background: #07080b;
    }

    html.${SIMPLE_CLASS} [data-runtime-simple-welcome] {
      display: grid;
      gap: 12px;
      text-align: center;
      margin-bottom: 8px;
    }

    html.${SIMPLE_CLASS} [data-runtime-simple-welcome] h1 {
      margin: 0;
      font-size: clamp(34px, 9vw, 54px);
      line-height: 1.08;
      font-weight: 500;
      letter-spacing: -.03em;
    }

    html.${SIMPLE_CLASS} [data-runtime-simple-welcome] p {
      max-width: 440px;
      margin: 0 auto;
      color: #858e9f;
      font-size: 15px;
      line-height: 1.5;
    }

    html.${SIMPLE_CLASS} [data-runtime-simple-step] {
      margin: 28px 0 0;
      color: #697284;
      font-size: 11px;
      text-align: center;
    }

    html.${ADVANCED_CLASS} [data-runtime-simple-welcome],
    html.${ADVANCED_CLASS} [data-runtime-simple-step] {
      display: none !important;
    }

    @media (max-width: 900px) {
      html.${SIMPLE_CLASS} .topbar {
        flex-direction: initial;
        align-items: center;
      }
    }
  `;
  document.head.append(style);
}

function ensureWelcome(assets: HTMLElement): void {
  let welcome = assets.querySelector<HTMLElement>("[data-runtime-simple-welcome]");
  if (welcome === null) {
    welcome = document.createElement("section");
    welcome.dataset.runtimeSimpleWelcome = "true";

    const heading = document.createElement("h1");
    heading.textContent = "What do you want to make today?";
    const note = document.createElement("p");
    note.textContent = "Open a project and work through only the actions you need.";
    welcome.append(heading, note);
    assets.prepend(welcome);
  }

  let step = assets.querySelector<HTMLElement>("[data-runtime-simple-step]");
  if (step === null) {
    step = document.createElement("p");
    step.dataset.runtimeSimpleStep = "true";
    assets.append(step);
  }
  step.textContent = currentProjectOpen()
    ? "Project open · edit, save, or export"
    : "Step 1 · Open a project";
}

function ensureMenu(topbar: HTMLElement): void {
  let button = topbar.querySelector<HTMLButtonElement>("[data-runtime-simple-menu]");
  if (button === null) {
    button = document.createElement("button");
    button.type = "button";
    button.dataset.runtimeSimpleMenu = "true";
    button.addEventListener("click", () => {
      advancedVisible = !advancedVisible;
      scheduleSync();
    });
    topbar.append(button);
  }

  button.textContent = advancedVisible ? "×" : "☰";
  button.setAttribute("aria-label", advancedVisible ? "Return to simple view" : "Open advanced controls");
  button.title = advancedVisible ? "Simple view" : "Advanced controls";
}

function simplifyLabels(): void {
  const exportButton = document.querySelector<HTMLButtonElement>("[data-export-mp4-button]");
  if (exportButton !== null && !exportButton.textContent?.startsWith("Exporting")) {
    exportButton.textContent = "Export video";
  }

  const saveButton = document.querySelector<HTMLButtonElement>("[data-save-aistudio-button]");
  if (saveButton !== null && saveButton.textContent !== "Saving…") {
    saveButton.textContent = "Save project";
  }

  const openButton = document.querySelector<HTMLButtonElement>("[data-open-aistudio-button]");
  if (openButton !== null) openButton.textContent = "Open project file";
}

function syncSimpleUi(): void {
  syncQueued = false;
  if (window.AIStudioRuntime === undefined) return;

  ensureSimpleStyles();
  const html = document.documentElement;
  html.classList.toggle(SIMPLE_CLASS, !advancedVisible);
  html.classList.toggle(ADVANCED_CLASS, advancedVisible);
  html.dataset.runtimeProjectOpen = String(currentProjectOpen());

  const topbar = document.querySelector<HTMLElement>(".topbar");
  if (topbar !== null) ensureMenu(topbar);

  const assets = document.querySelector<HTMLElement>(".assets-panel");
  if (assets !== null) ensureWelcome(assets);

  if (!advancedVisible) simplifyLabels();
}

function scheduleSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  window.setTimeout(syncSimpleUi, 0);
}

export function installRuntimeSimpleUi(): void {
  window.addEventListener("aistudio:runtime-ready", scheduleSync);
  document.addEventListener("click", scheduleSync, true);
  document.addEventListener("change", scheduleSync, true);
  new MutationObserver(scheduleSync).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  scheduleSync();
}

installRuntimeSimpleUi();
