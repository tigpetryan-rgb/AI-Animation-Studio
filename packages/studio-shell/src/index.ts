import type {
  CapabilityPlan,
  CapabilityWarning,
  PlatformTier,
  StudioMode,
} from "@aistudio/platform-capabilities";

export type StudioWorkspace =
  | "DIRECTOR"
  | "STORYBOARD"
  | "WORLD"
  | "ACTORS"
  | "ANIMATE"
  | "EDIT"
  | "COMPOSE"
  | "AUDIO"
  | "QC"
  | "DELIVER";

export const STUDIO_WORKSPACES: readonly StudioWorkspace[] = Object.freeze([
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

export type ProjectSessionStatus = "CLOSED" | "OPEN";

export interface StudioShellState {
  readonly workspace: StudioWorkspace;
  readonly mode: StudioMode;
  readonly tier: PlatformTier;
  readonly projectStatus: ProjectSessionStatus;
  readonly activeProjectId: string | null;
  readonly dirty: boolean;
  readonly capabilityWarnings: readonly CapabilityWarning[];
  readonly revision: number;
}

export type StudioShellAction =
  | { readonly type: "SWITCH_WORKSPACE"; readonly workspace: StudioWorkspace }
  | { readonly type: "OPEN_PROJECT"; readonly projectId: string }
  | { readonly type: "CLOSE_PROJECT" }
  | { readonly type: "MARK_DIRTY" }
  | { readonly type: "MARK_SAVED" };

export type ShellDiagnosticCode =
  | "SHELL_INVALID_PROJECT_ID"
  | "SHELL_NO_OPEN_PROJECT";

export interface ShellDiagnostic {
  readonly code: ShellDiagnosticCode;
  readonly message: string;
}

export interface ShellTransitionResult {
  readonly state: StudioShellState;
  readonly diagnostics: readonly ShellDiagnostic[];
}

export interface PwaContract {
  readonly name: string;
  readonly shortName: string;
  readonly display: "standalone";
  readonly startUrl: string;
  readonly scope: string;
  readonly serviceWorkerRequiredForOfflineInstall: true;
  readonly localFirst: true;
  readonly mandatoryServer: false;
  readonly mandatoryApi: false;
}

export function pwaContract(): PwaContract {
  return Object.freeze({
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
}

export function createStudioShellState(plan: CapabilityPlan): StudioShellState {
  return Object.freeze({
    workspace: "DIRECTOR",
    mode: plan.mode,
    tier: plan.tier,
    projectStatus: "CLOSED",
    activeProjectId: null,
    dirty: false,
    capabilityWarnings: Object.freeze([...plan.warnings]),
    revision: 0,
  });
}

function nextState(
  state: StudioShellState,
  patch: Partial<Omit<StudioShellState, "mode" | "tier" | "capabilityWarnings">>,
): StudioShellState {
  return Object.freeze({
    ...state,
    ...patch,
    capabilityWarnings: state.capabilityWarnings,
    revision: state.revision + 1,
  });
}

export function applyStudioShellAction(
  state: StudioShellState,
  action: StudioShellAction,
): ShellTransitionResult {
  switch (action.type) {
    case "SWITCH_WORKSPACE":
      return { state: nextState(state, { workspace: action.workspace }), diagnostics: [] };

    case "OPEN_PROJECT": {
      const projectId = action.projectId.trim();
      if (projectId.length === 0) {
        return {
          state,
          diagnostics: [{ code: "SHELL_INVALID_PROJECT_ID", message: "Project id must not be empty." }],
        };
      }
      return {
        state: nextState(state, {
          projectStatus: "OPEN",
          activeProjectId: projectId,
          dirty: false,
        }),
        diagnostics: [],
      };
    }

    case "CLOSE_PROJECT":
      return {
        state: nextState(state, {
          projectStatus: "CLOSED",
          activeProjectId: null,
          dirty: false,
        }),
        diagnostics: [],
      };

    case "MARK_DIRTY":
      if (state.projectStatus !== "OPEN") {
        return {
          state,
          diagnostics: [{ code: "SHELL_NO_OPEN_PROJECT", message: "Cannot mark a closed project as dirty." }],
        };
      }
      return { state: nextState(state, { dirty: true }), diagnostics: [] };

    case "MARK_SAVED":
      if (state.projectStatus !== "OPEN") {
        return {
          state,
          diagnostics: [{ code: "SHELL_NO_OPEN_PROJECT", message: "Cannot save when no project is open." }],
        };
      }
      return { state: nextState(state, { dirty: false }), diagnostics: [] };
  }
}

export function workspaceAvailable(
  _mode: StudioMode,
  workspace: StudioWorkspace,
): boolean {
  return STUDIO_WORKSPACES.includes(workspace);
}

export function capabilityBanner(plan: CapabilityPlan): string {
  const prefix = plan.mode === "FULL_STUDIO" ? "Full Studio" : "Compatibility Mode";
  const warningSuffix = plan.warnings.length === 0
    ? "All declared platform requirements are available."
    : `${plan.warnings.length} platform fallback warning${plan.warnings.length === 1 ? "" : "s"}.`;
  return `${prefix} · ${plan.tier} · ${warningSuffix}`;
}

export function serviceWorkerShellAssets(): readonly string[] {
  return Object.freeze([
    "./",
    "./index.html",
    "./manifest.webmanifest",
  ]);
}
