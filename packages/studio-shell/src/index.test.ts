import { describe, expect, it } from "vitest";
import { buildCapabilityPlan, type BrowserCapabilitySnapshot } from "@aistudio/platform-capabilities";
import {
  STUDIO_WORKSPACES,
  applyStudioShellAction,
  capabilityBanner,
  createStudioShellState,
  pwaContract,
  serviceWorkerShellAssets,
  workspaceAvailable,
} from "./index.js";

function snapshot(overrides: Partial<BrowserCapabilitySnapshot> = {}): BrowserCapabilitySnapshot {
  return {
    secureContext: true,
    serviceWorker: true,
    opfs: true,
    indexedDb: true,
    webgpu: true,
    webgl2: true,
    webcodecs: true,
    wasm: true,
    wasmSimd: true,
    sharedArrayBuffer: true,
    offscreenCanvas: true,
    logicalCores: 8,
    deviceMemoryGB: 16,
    ...overrides,
  };
}

describe("studio shell", () => {
  it("freezes the ten primary workspaces", () => {
    expect(STUDIO_WORKSPACES).toEqual([
      "DIRECTOR",
      "STORYBOARD",
      "WORLD",
      "ACTORS",
      "ANIMATE",
      "EDIT",
      "COMPOSE",
      "AUDIO",
      "QC",
      "DELIVER",
    ]);
    expect(Object.isFrozen(STUDIO_WORKSPACES)).toBe(true);
  });

  it("inherits Full Studio mode and device tier from platform capability planning", () => {
    const state = createStudioShellState(buildCapabilityPlan(snapshot()));
    expect(state.mode).toBe("FULL_STUDIO");
    expect(state.tier).toBe("ULTRA");
    expect(state.workspace).toBe("DIRECTOR");
    expect(state.projectStatus).toBe("CLOSED");
    expect(state.activeProjectId).toBeNull();
    expect(state.dirty).toBe(false);
  });

  it("keeps every workspace navigable in Compatibility Mode", () => {
    const plan = buildCapabilityPlan(snapshot({ secureContext: false, serviceWorker: false, opfs: false }));
    const state = createStudioShellState(plan);
    expect(state.mode).toBe("COMPATIBILITY");
    for (const workspace of STUDIO_WORKSPACES) {
      expect(workspaceAvailable(state.mode, workspace)).toBe(true);
    }
  });

  it("applies project lifecycle transitions without mutating prior state", () => {
    const initial = createStudioShellState(buildCapabilityPlan(snapshot()));
    const opened = applyStudioShellAction(initial, { type: "OPEN_PROJECT", projectId: " film-1 " }).state;
    const dirty = applyStudioShellAction(opened, { type: "MARK_DIRTY" }).state;
    const saved = applyStudioShellAction(dirty, { type: "MARK_SAVED" }).state;
    const switched = applyStudioShellAction(saved, { type: "SWITCH_WORKSPACE", workspace: "EDIT" }).state;
    const closed = applyStudioShellAction(switched, { type: "CLOSE_PROJECT" }).state;

    expect(initial.projectStatus).toBe("CLOSED");
    expect(opened.activeProjectId).toBe("film-1");
    expect(dirty.dirty).toBe(true);
    expect(saved.dirty).toBe(false);
    expect(switched.workspace).toBe("EDIT");
    expect(closed.projectStatus).toBe("CLOSED");
    expect(closed.activeProjectId).toBeNull();
    expect(closed.revision).toBe(5);
  });

  it("rejects empty project ids and dirty/save actions without an open project", () => {
    const state = createStudioShellState(buildCapabilityPlan(snapshot()));
    expect(applyStudioShellAction(state, { type: "OPEN_PROJECT", projectId: "  " }).diagnostics[0]?.code).toBe("SHELL_INVALID_PROJECT_ID");
    expect(applyStudioShellAction(state, { type: "MARK_DIRTY" }).diagnostics[0]?.code).toBe("SHELL_NO_OPEN_PROJECT");
    expect(applyStudioShellAction(state, { type: "MARK_SAVED" }).diagnostics[0]?.code).toBe("SHELL_NO_OPEN_PROJECT");
  });

  it("declares an offline-first PWA contract without mandatory server or API", () => {
    expect(pwaContract()).toEqual({
      name: "AI Animation Studio",
      shortName: "AI Studio",
      display: "standalone",
      startUrl: "./",
      scope: "./",
      serviceWorkerRequiredForOfflineInstall: true,
      localFirst: true,
      mandatoryServer: false,
      mandatoryApi: false,
    });
    expect(serviceWorkerShellAssets()).toEqual(["./", "./index.html", "./manifest.webmanifest"]);
  });

  it("surfaces capability status in a deterministic banner", () => {
    expect(capabilityBanner(buildCapabilityPlan(snapshot()))).toBe("Full Studio · ULTRA · All declared platform requirements are available.");
    expect(capabilityBanner(buildCapabilityPlan(snapshot({ webgpu: false })))).toContain("platform fallback warning");
  });
});
