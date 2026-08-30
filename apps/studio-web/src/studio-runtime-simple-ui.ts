const SIMPLE_CLASS = "runtime-simple-ui";
const ADVANCED_CLASS = "runtime-advanced-ui";

let advancedVisible = false;
let menuOpen = false;
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
      border-radius: 12px;
      background: #14171d;
      color: #eef1f5;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
    }

    html.${SIMPLE_CLASS} body {
      background: #07080b;
    }

    html.${SIMPLE_CLASS}[data-runtime-menu-open="true"] body {
      overflow: hidden;
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

    [data-runtime-simple-drawer],
    [data-runtime-simple-drawer-backdrop] {
      display: none;
    }

    html.${SIMPLE_CLASS} [data-runtime-simple-drawer-backdrop] {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 80;
      border: 0;
      padding: 0;
      background: rgba(0, 0, 0, .58);
      opacity: 0;
      pointer-events: none;
      transition: opacity 160ms ease;
    }

    html.${SIMPLE_CLASS} [data-runtime-simple-drawer] {
      display: flex;
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 90;
      width: min(84vw, 304px);
      box-sizing: border-box;
      flex-direction: column;
      padding: 14px 12px 16px;
      border-right: 1px solid #20242c;
      background: #0b0c0f;
      color: #f4f5f7;
      box-shadow: 24px 0 64px rgba(0, 0, 0, .42);
      transform: translateX(-104%);
      transition: transform 180ms ease;
    }

    html.${SIMPLE_CLASS}[data-runtime-menu-open="true"] [data-runtime-simple-drawer-backdrop] {
      opacity: 1;
      pointer-events: auto;
    }

    html.${SIMPLE_CLASS}[data-runtime-menu-open="true"] [data-runtime-simple-drawer] {
      transform: translateX(0);
    }

    html.${SIMPLE_CLASS} [data-runtime-simple-drawer-header] {
      display: flex;
      min-height: 48px;
      align-items: center;
      gap: 10px;
      padding: 2px 8px 10px;
    }

    html.${SIMPLE_CLASS} [data-runtime-simple-drawer-mark] {
      display: grid;
      width: 30px;
      height: 30px;
      place-items: center;
      border: 1px solid #333944;
      border-radius: 9px;
      background: #f4f5f7;
      color: #090a0d;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: -.04em;
    }

    html.${SIMPLE_CLASS} [data-runtime-simple-drawer-title] {
      display: grid;
      min-width: 0;
      gap: 1px;
    }

    html.${SIMPLE_CLASS} [data-runtime-simple-drawer-title] strong {
      overflow: hidden;
      font-size: 14px;
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    html.${SIMPLE_CLASS} [data-runtime-simple-drawer-title] span {
      color: #747c89;
      font-size: 10px;
    }

    html.${SIMPLE_CLASS} [data-runtime-menu-primary] {
      width: 100%;
      min-height: 44px;
      margin: 4px 0 14px;
      border: 1px solid #353b46;
      border-radius: 10px;
      background: #f3f4f6;
      color: #090a0d;
      font-size: 13px;
      font-weight: 650;
      text-align: left;
      cursor: pointer;
    }

    html.${SIMPLE_CLASS} [data-runtime-menu-section] {
      display: grid;
      gap: 2px;
      margin-bottom: 10px;
    }

    html.${SIMPLE_CLASS} [data-runtime-menu-section-label] {
      margin: 10px 9px 5px;
      color: #626a77;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    html.${SIMPLE_CLASS} [data-runtime-menu-action] {
      display: grid;
      width: 100%;
      min-height: 42px;
      grid-template-columns: 26px 1fr;
      align-items: center;
      gap: 7px;
      padding: 0 10px;
      border: 0;
      border-radius: 9px;
      background: transparent;
      color: #c7ccd5;
      font-size: 13px;
      text-align: left;
      cursor: pointer;
    }

    html.${SIMPLE_CLASS} [data-runtime-menu-action]:hover,
    html.${SIMPLE_CLASS} [data-runtime-menu-action]:focus-visible {
      outline: none;
      background: #171a20;
      color: #fff;
    }

    html.${SIMPLE_CLASS} [data-runtime-menu-action][data-active="true"] {
      background: #181b21;
      color: #fff;
    }

    html.${SIMPLE_CLASS} [data-runtime-menu-action]:disabled,
    html.${SIMPLE_CLASS} [data-runtime-menu-primary]:disabled {
      cursor: default;
      opacity: .38;
    }

    html.${SIMPLE_CLASS} [data-runtime-menu-icon] {
      display: grid;
      width: 24px;
      height: 24px;
      place-items: center;
      color: inherit;
      font-size: 16px;
      line-height: 1;
    }

    html.${SIMPLE_CLASS} [data-runtime-simple-drawer-footer] {
      display: grid;
      gap: 4px;
      margin-top: auto;
      padding-top: 12px;
      border-top: 1px solid #1c2027;
    }

    html.${SIMPLE_CLASS} [data-runtime-simple-drawer-status] {
      margin: 5px 10px 2px;
      color: #666f7e;
      font-size: 10px;
      line-height: 1.4;
    }

    html.${ADVANCED_CLASS} [data-runtime-simple-welcome],
    html.${ADVANCED_CLASS} [data-runtime-simple-step],
    html.${ADVANCED_CLASS} [data-runtime-simple-drawer],
    html.${ADVANCED_CLASS} [data-runtime-simple-drawer-backdrop] {
      display: none !important;
    }

    @media (min-width: 900px) {
      html.${SIMPLE_CLASS} [data-runtime-simple-drawer] {
        width: 288px;
      }
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

function menuButton(action: string, label: string, icon: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.runtimeMenuAction = action;

  const iconNode = document.createElement("span");
  iconNode.dataset.runtimeMenuIcon = "true";
  iconNode.setAttribute("aria-hidden", "true");
  iconNode.textContent = icon;

  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  button.append(iconNode, labelNode);
  return button;
}

function closeMenu(): void {
  menuOpen = false;
  scheduleSync();
}

function runMenuAction(action: string): void {
  if (action === "home") {
    window.scrollTo({ top: 0, behavior: "smooth" });
    closeMenu();
    return;
  }

  if (action === "editor") {
    document.querySelector<HTMLElement>(".viewport")?.scrollIntoView({ behavior: "smooth", block: "start" });
    closeMenu();
    return;
  }

  if (action === "open") {
    const openFile = document.querySelector<HTMLButtonElement>("[data-open-aistudio-button]");
    const demo = document.querySelector<HTMLButtonElement>(".assets-panel > button.primary:not(:disabled)");
    (openFile ?? demo)?.click();
    closeMenu();
    return;
  }

  if (action === "save") {
    document.querySelector<HTMLButtonElement>("[data-save-aistudio-button]")?.click();
    closeMenu();
    return;
  }

  if (action === "export") {
    document.querySelector<HTMLButtonElement>("[data-export-mp4-button]")?.click();
    closeMenu();
    return;
  }

  if (action === "advanced") {
    menuOpen = false;
    advancedVisible = true;
    scheduleSync();
  }
}

function ensureDrawer(): HTMLElement {
  let drawer = document.querySelector<HTMLElement>("[data-runtime-simple-drawer]");
  if (drawer !== null) return drawer;

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.dataset.runtimeSimpleDrawerBackdrop = "true";
  backdrop.setAttribute("aria-label", "Close menu");
  backdrop.addEventListener("click", closeMenu);

  drawer = document.createElement("aside");
  drawer.dataset.runtimeSimpleDrawer = "true";
  drawer.setAttribute("aria-label", "Studio navigation");

  const header = document.createElement("div");
  header.dataset.runtimeSimpleDrawerHeader = "true";
  const mark = document.createElement("span");
  mark.dataset.runtimeSimpleDrawerMark = "true";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "AI";
  const title = document.createElement("div");
  title.dataset.runtimeSimpleDrawerTitle = "true";
  const titleStrong = document.createElement("strong");
  titleStrong.textContent = "AI Animation Studio";
  const titleMeta = document.createElement("span");
  titleMeta.textContent = "Controlled Runtime";
  title.append(titleStrong, titleMeta);
  header.append(mark, title);

  const primary = document.createElement("button");
  primary.type = "button";
  primary.dataset.runtimeMenuPrimary = "true";
  primary.dataset.runtimeMenuAction = "open";
  primary.textContent = "+  Open project";

  const createSection = document.createElement("section");
  createSection.dataset.runtimeMenuSection = "true";
  createSection.append(menuButton("home", "Home", "⌂"), menuButton("editor", "Editor", "✦"));

  const projectLabel = document.createElement("p");
  projectLabel.dataset.runtimeMenuSectionLabel = "true";
  projectLabel.textContent = "Project";
  const projectSection = document.createElement("section");
  projectSection.dataset.runtimeMenuSection = "true";
  projectSection.append(
    projectLabel,
    menuButton("open", "Open project", "▣"),
    menuButton("save", "Save project", "↓"),
  );

  const outputLabel = document.createElement("p");
  outputLabel.dataset.runtimeMenuSectionLabel = "true";
  outputLabel.textContent = "Output";
  const outputSection = document.createElement("section");
  outputSection.dataset.runtimeMenuSection = "true";
  outputSection.append(outputLabel, menuButton("export", "Export video", "↑"));

  const footer = document.createElement("footer");
  footer.dataset.runtimeSimpleDrawerFooter = "true";
  footer.append(menuButton("advanced", "Advanced controls", "⚙"));
  const status = document.createElement("p");
  status.dataset.runtimeSimpleDrawerStatus = "true";
  footer.append(status);

  drawer.append(header, primary, createSection, projectSection, outputSection, footer);
  drawer.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-runtime-menu-action]")
      : null;
    if (target === null || target.disabled) return;
    runMenuAction(target.dataset.runtimeMenuAction ?? "");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuOpen) closeMenu();
  });
  document.body.append(backdrop, drawer);
  return drawer;
}

function syncDrawer(drawer: HTMLElement): void {
  const hasProject = currentProjectOpen();
  const editor = drawer.querySelector<HTMLButtonElement>("[data-runtime-menu-action=\"editor\"]");
  const save = drawer.querySelector<HTMLButtonElement>("[data-runtime-menu-action=\"save\"]");
  const exportButton = drawer.querySelector<HTMLButtonElement>("[data-runtime-menu-action=\"export\"]");
  if (editor !== null) editor.disabled = !hasProject;
  if (save !== null) save.disabled = !hasProject;
  if (exportButton !== null) exportButton.disabled = !hasProject;

  const home = drawer.querySelector<HTMLButtonElement>("[data-runtime-menu-action=\"home\"]");
  if (home !== null) home.dataset.active = String(!hasProject);
  if (editor !== null) editor.dataset.active = String(hasProject);

  const status = drawer.querySelector<HTMLElement>("[data-runtime-simple-drawer-status]");
  if (status !== null) {
    status.textContent = hasProject
      ? "Project open · editing tools are ready"
      : "No project open";
  }
}

function ensureMenu(topbar: HTMLElement): void {
  let button = topbar.querySelector<HTMLButtonElement>("[data-runtime-simple-menu]");
  if (button === null) {
    button = document.createElement("button");
    button.type = "button";
    button.dataset.runtimeSimpleMenu = "true";
    button.addEventListener("click", () => {
      if (advancedVisible) {
        advancedVisible = false;
        menuOpen = false;
      } else {
        menuOpen = !menuOpen;
      }
      scheduleSync();
    });
    topbar.append(button);
  }

  if (advancedVisible) {
    button.textContent = "←";
    button.setAttribute("aria-label", "Return to simple view");
    button.title = "Simple view";
    return;
  }

  button.textContent = menuOpen ? "×" : "☰";
  button.setAttribute("aria-label", menuOpen ? "Close navigation" : "Open navigation");
  button.setAttribute("aria-expanded", String(menuOpen));
  button.title = menuOpen ? "Close menu" : "Menu";
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
  if (advancedVisible) menuOpen = false;
  html.classList.toggle(SIMPLE_CLASS, !advancedVisible);
  html.classList.toggle(ADVANCED_CLASS, advancedVisible);
  html.dataset.runtimeProjectOpen = String(currentProjectOpen());
  html.dataset.runtimeMenuOpen = String(menuOpen && !advancedVisible);

  const topbar = document.querySelector<HTMLElement>(".topbar");
  if (topbar !== null) ensureMenu(topbar);

  const drawer = ensureDrawer();
  syncDrawer(drawer);

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
