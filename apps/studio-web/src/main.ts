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
import {
  analyzeDeviceVerificationReport,
  currentStudioBuildIdentity,
  parseDeviceVerificationReport,
  runBrowserDeviceVerification,
  serializeDeviceVerificationReport,
  type DeviceVerificationReport,
} from "./device-check";
import {
  runPerformanceBenchmark,
  serializePerformanceBenchmarkReport,
  type PerformanceBenchmarkReport,
} from "./performance-benchmark";
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
const studioBuild = currentStudioBuildIdentity();
let shellState: StudioShellState = boot.shell;
let deviceReport: DeviceVerificationReport | null = null;
let deviceReportSource: "LIVE" | "IMPORTED" | null = null;
let deviceReportError: string | null = null;
let deviceCheckRunning = false;
let performanceReport: PerformanceBenchmarkReport | null = null;
let performanceBenchmarkError: string | null = null;
let performanceBenchmarkRunning = false;
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

async function runDeviceCheck(): Promise<void> {
  deviceCheckRunning = true;
  deviceReportError = null;
  render();
  try {
    deviceReport = await runBrowserDeviceVerification();
    deviceReportSource = "LIVE";
  } catch (error) {
    deviceReportError = error instanceof Error ? error.message : "Device check failed.";
  } finally {
    deviceCheckRunning = false;
    render();
  }
}

async function importDeviceReport(file: File): Promise<void> {
  const validation = parseDeviceVerificationReport(await file.text(), studioBuild);
  if (!validation.ok) {
    deviceReportError = validation.issues.join(" ");
    render();
    return;
  }

  deviceReport = validation.report;
  deviceReportSource = "IMPORTED";
  deviceReportError = null;
  render();
}

function downloadDeviceReport(report: DeviceVerificationReport): void {
  const blob = new Blob([serializeDeviceVerificationReport(report)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `aistudio-device-verification-${report.capturedAt.replaceAll(":", "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function runBenchmark(): Promise<void> {
  performanceBenchmarkRunning = true;
  performanceBenchmarkError = null;
  render();
  try {
    performanceReport = await runPerformanceBenchmark();
  } catch (error) {
    performanceBenchmarkError = error instanceof Error ? error.message : "Performance benchmark failed.";
  } finally {
    performanceBenchmarkRunning = false;
    render();
  }
}

function downloadPerformanceReport(report: PerformanceBenchmarkReport): void {
  const blob = new Blob([serializePerformanceBenchmarkReport(report)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `aistudio-performance-benchmark-${report.capturedAt.replaceAll(":", "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderDeviceVerification(inspector: HTMLElement): void {
  inspector.append(text("h3", "Device verification"));

  const controls = el("div", "device-check-controls");
  const runButton = el("button", "device-check-button");
  runButton.type = "button";
  runButton.textContent = deviceCheckRunning ? "Checking device…" : "Run device check";
  runButton.disabled = deviceCheckRunning;
  runButton.addEventListener("click", () => void runDeviceCheck());

  const fileInput = el("input", "device-report-input");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  fileInput.dataset.deviceReportInput = "true";
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) void importDeviceReport(file);
  });

  const importButton = el("button", "device-report-import");
  importButton.type = "button";
  importButton.textContent = "Import device report";
  importButton.addEventListener("click", () => fileInput.click());
  controls.append(runButton, importButton, fileInput);
  inspector.append(controls);

  if (deviceReportError) {
    const error = text("p", deviceReportError, "device-report-error");
    error.setAttribute("role", "alert");
    inspector.append(error);
  }

  if (!deviceReport) return;

  const intake = analyzeDeviceVerificationReport(deviceReport);
  const summary = text(
    "div",
    `Device check: ${deviceReport.summary}`,
    `device-summary summary-${deviceReport.summary.toLowerCase()}`,
  );
  summary.dataset.summary = deviceReport.summary;
  inspector.append(summary);

  const mode = text(
    "div",
    `Compatibility: ${intake.mode}`,
    `compatibility-mode mode-${intake.mode.toLowerCase()}`,
  );
  mode.dataset.compatibilityMode = intake.mode;
  inspector.append(mode);

  const meta = el("div", "device-report-meta");
  meta.append(
    text("span", deviceReportSource === "IMPORTED" ? "Imported report" : "Live browser"),
    text("span", `Build ${deviceReport.build.commit.slice(0, 12)}`),
    text("span", new Date(deviceReport.capturedAt).toLocaleString()),
  );
  inspector.append(meta);

  const coverage = el("div", "device-report-coverage");
  coverage.append(
    text("span", `Required ${intake.requiredPassed}/${intake.requiredTotal}`),
    text("span", `Optional ${intake.optionalPassed}/${intake.optionalTotal}`),
  );
  inspector.append(coverage, text("p", deviceReport.userAgent, "device-user-agent"));

  const list = el("ul", "device-check-list");
  for (const check of deviceReport.checks) {
    const item = el("li", `check-${check.status.toLowerCase()}`);
    item.dataset.checkId = check.id;
    const headline = el("div", "check-headline");
    headline.append(text("span", check.label), text("strong", check.status));
    item.append(headline, text("p", `${check.detail} · ${check.durationMs} ms`, "muted"));
    list.append(item);
  }
  inspector.append(list);

  const downloadButton = el("button", "device-report-download");
  downloadButton.type = "button";
  downloadButton.textContent = "Download verification report";
  downloadButton.addEventListener("click", () => downloadDeviceReport(deviceReport as DeviceVerificationReport));
  inspector.append(downloadButton, text("p", deviceReport.note, "verification-note"));
}

function renderPerformanceBenchmark(inspector: HTMLElement): void {
  inspector.append(text("h3", "Performance benchmark"));
  inspector.append(
    text(
      "p",
      "Measures this browser session without applying uncalibrated pass/fail speed thresholds.",
      "verification-note",
    ),
  );

  const runButton = el("button", "performance-benchmark-button");
  runButton.type = "button";
  runButton.textContent = performanceBenchmarkRunning ? "Benchmarking…" : "Run performance benchmark";
  runButton.disabled = performanceBenchmarkRunning || deviceCheckRunning;
  runButton.addEventListener("click", () => void runBenchmark());
  inspector.append(runButton);

  if (performanceBenchmarkError) {
    const error = text("p", performanceBenchmarkError, "device-report-error");
    error.setAttribute("role", "alert");
    inspector.append(error);
  }

  if (!performanceReport) return;

  const summary = text(
    "div",
    `Benchmark: ${performanceReport.summary}`,
    `performance-summary performance-${performanceReport.summary.toLowerCase()}`,
  );
  summary.dataset.performanceSummary = performanceReport.summary;
  inspector.append(summary);

  const meta = el("div", "device-report-meta");
  meta.append(
    text("span", `Build ${performanceReport.build.commit.slice(0, 12)}`),
    text("span", new Date(performanceReport.capturedAt).toLocaleString()),
  );
  inspector.append(meta);

  const list = el("ul", "performance-measurement-list");
  for (const measurement of performanceReport.measurements) {
    const item = el("li", `benchmark-${measurement.status.toLowerCase()}`);
    item.dataset.benchmarkId = measurement.id;
    const headline = el("div", "check-headline");
    headline.append(text("span", measurement.label), text("strong", measurement.status));
    item.append(headline, text("p", `${measurement.detail} · ${measurement.durationMs} ms`, "muted"));

    const metrics = Object.entries(measurement.metrics);
    if (metrics.length > 0) {
      const metricList = el("dl", "benchmark-metrics");
      for (const [name, value] of metrics) {
        const metricValue = value === null ? "n/a" : String(value);
        metricList.append(text("dt", name), text("dd", metricValue));
      }
      item.append(metricList);
    }
    list.append(item);
  }
  inspector.append(list);

  const downloadButton = el("button", "performance-report-download");
  downloadButton.type = "button";
  downloadButton.textContent = "Download performance report";
  downloadButton.addEventListener("click", () => downloadPerformanceReport(performanceReport as PerformanceBenchmarkReport));
  inspector.append(downloadButton, text("p", performanceReport.note, "verification-note"));
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

  const buildRow = el("div", "kv-row studio-build-row");
  buildRow.dataset.studioBuildCommit = studioBuild.commit;
  buildRow.dataset.studioBuildSourceDate = studioBuild.sourceDate;
  buildRow.append(text("span", "Build"), text("strong", studioBuild.commit.slice(0, 12)));
  inspector.append(buildRow);

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

  renderDeviceVerification(inspector);
  renderPerformanceBenchmark(inspector);
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
