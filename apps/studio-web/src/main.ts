import "./styles.css";
import {
  probeWithEvidence,
  safeBrowserFeatureProbes,
  type BrowserGlobalLike,
} from "@aistudio/browser-probe";
import {
  applyStudioShellAction,
  STUDIO_WORKSPACES,
  type StudioShellState,
  type StudioWorkspace,
} from "@aistudio/studio-shell";
import { createStudioBootModel } from "./runtime";

function probeWebGl2(): boolean {
  const canvas = document.createElement("canvas");
  return canvas.getContext("webgl2") !== null;
}

function probeWasmSimd(): boolean {
  if (typeof WebAssembly !== "object" || typeof WebAssembly.validate !== "function") return false;
  try {
    const simdModule = new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0,
      1, 5, 1, 96, 0, 1, 123,
      3, 2, 1, 0,
      10, 10, 1, 8, 0, 65, 0, 253, 15, 11,
    ]);
    return WebAssembly.validate(simdModule);
  } catch {
    return false;
  }
}

function requireStudioRoot(): HTMLDivElement {
  const node = document.querySelector<HTMLDivElement>("#app");
  if (node === null) throw new Error("Studio root element was not found.");
  return node;
}

const evidence = probeWithEvidence(
  globalThis as unknown as BrowserGlobalLike,
  safeBrowserFeatureProbes({ webgl2: probeWebGl2, wasmSimd: probeWasmSimd }),
);
const boot = createStudioBootModel(evidence.snapshot);
let shellState: StudioShellState = boot.shell;
const root = requireStudioRoot();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function text(tag: keyof HTMLElementTagNameMap, value: string, className?: string): HTMLElement {
  const node = el(tag, className);
  node.textContent = value;
  return node;
}

function capabilityRows(): readonly [string, string][] {
  return [
    ["Mode", boot.plan.mode],
    ["Tier", boot.plan.tier],
    ["Renderer", boot.plan.renderer],
    ["Compute", boot.plan.compute],
    ["Storage", boot.plan.storage],
    ["Codec", boot.plan.codec],
    ["Memory budget", `${boot.plan.memoryBudgetMB} MB`],
  ];
}

function switchWorkspace(workspace: StudioWorkspace): void {
  shellState = applyStudioShellAction(shellState, { type: "SWITCH_WORKSPACE", workspace }).state;
  render();
}

function openDemoProject(): void {
  shellState = applyStudioShellAction(shellState, {
    type: "OPEN_PROJECT",
    projectId: "local-demo-project",
  }).state;
  render();
}

function render(): void {
  root.replaceChildren();

  const frame = el("main", "studio-frame");
  const topbar = el("header", "topbar");
  const brand = el("div", "brand");
  brand.append(text("strong", "AI Animation Studio"), text("span", "Local-first Movie Operating System"));
  topbar.append(brand, text("span", boot.banner, "capability-banner"));

  const nav = el("nav", "workspace-nav");
  for (const workspace of STUDIO_WORKSPACES) {
    const button = el("button", workspace === shellState.workspace ? "active" : undefined);
    button.type = "button";
    button.textContent = workspace;
    button.addEventListener("click", () => switchWorkspace(workspace));
    nav.append(button);
  }

  const body = el("section", "studio-body");
  const assets = el("aside", "panel assets-panel");
  assets.append(text("h2", "Project"));
  const projectValue = shellState.activeProjectId ?? "No project open";
  assets.append(text("p", projectValue, "muted"));
  const projectButton = el("button", "primary");
  projectButton.type = "button";
  projectButton.textContent = shellState.projectStatus === "OPEN" ? "Project open" : "Open local demo";
  projectButton.disabled = shellState.projectStatus === "OPEN";
  projectButton.addEventListener("click", openDemoProject);
  assets.append(projectButton);

  const viewport = el("section", "viewport");
  viewport.append(
    text("span", shellState.workspace, "eyebrow"),
    text("h1", "Production viewport"),
    text("p", "The runtime shell is live. Rendering, media and local AI adapters attach here without changing canonical movie state.", "muted"),
  );
  const stage = el("div", "stage-placeholder");
  stage.append(text("span", "LOCAL PREVIEW"));
  viewport.append(stage);

  const inspector = el("aside", "panel inspector");
  inspector.append(text("h2", "Runtime"));
  for (const [label, value] of capabilityRows()) {
    const row = el("div", "kv-row");
    row.append(text("span", label), text("strong", value));
    inspector.append(row);
  }

  if (boot.plan.warnings.length > 0) {
    inspector.append(text("h3", "Fallbacks"));
    const list = el("ul", "warning-list");
    for (const warning of boot.plan.warnings) {
      const item = el("li");
      item.textContent = warning.message;
      list.append(item);
    }
    inspector.append(list);
  }

  body.append(assets, viewport, inspector);

  const timeline = el("footer", "timeline");
  timeline.append(text("span", "00:00:00:00", "timecode"));
  const rail = el("div", "timeline-rail");
  rail.append(el("div", "playhead"));
  timeline.append(rail, text("span", `rev ${shellState.revision}`, "muted"));

  frame.append(topbar, nav, body, timeline);
  root.append(frame);
}

render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js").catch(() => {
      // Capability warnings already communicate degraded offline behavior.
    });
  });
}
