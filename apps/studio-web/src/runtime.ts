import { buildCapabilityPlan, type BrowserCapabilitySnapshot } from "@aistudio/platform-capabilities";
import { capabilityBanner, createStudioShellState } from "@aistudio/studio-shell";

export interface StudioBootModel {
  readonly snapshot: BrowserCapabilitySnapshot;
  readonly plan: ReturnType<typeof buildCapabilityPlan>;
  readonly shell: ReturnType<typeof createStudioShellState>;
  readonly banner: string;
}

export function createStudioBootModel(snapshot: BrowserCapabilitySnapshot): StudioBootModel {
  const plan = buildCapabilityPlan(snapshot);
  return Object.freeze({
    snapshot,
    plan,
    shell: createStudioShellState(plan),
    banner: capabilityBanner(plan),
  });
}
