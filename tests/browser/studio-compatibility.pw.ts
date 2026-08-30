import { expect, test } from "@playwright/test";

type CompatSnapshot = {
  rootChildren: number;
  label: string;
  projectControls: boolean;
  timelineEditor: boolean;
  saveDisabled: boolean | null;
  selectedSupported: string | null;
  exportDisabled: boolean | null;
  exportStatus: string;
};

test("Studio opens projects and gates export safely on this browser profile", async ({ page }) => {
  const pageErrors: string[] = [];
  const diagnostics: string[] = [];
  let postOpenSnapshot: CompatSnapshot | undefined;
  let resolvePostOpen: ((snapshot: CompatSnapshot) => void) | undefined;
  const postOpenReady = new Promise<CompatSnapshot>((resolve) => {
    resolvePostOpen = resolve;
  });

  page.on("pageerror", (error) => pageErrors.push(`${error.name}: ${error.message}`));
  page.on("console", (message) => {
    const value = message.text();
    if (!value.startsWith("[aistudio-compat-diag]")) return;
    diagnostics.push(value);
    console.log(value);

    const readyPrefix = "[aistudio-compat-diag] post-open-ready ";
    if (!value.startsWith(readyPrefix)) return;

    try {
      const snapshot = JSON.parse(value.slice(readyPrefix.length)) as CompatSnapshot;
      postOpenSnapshot = snapshot;
      resolvePostOpen?.(snapshot);
    } catch (error) {
      pageErrors.push(`compat snapshot parse failed: ${String(error)}`);
    }
  });

  await page.addInitScript(() => {
    const prefix = "[aistudio-compat-diag]";
    const snapshot = (): CompatSnapshot => {
      const root = document.querySelector<HTMLElement>("#app");
      const saveButton = root?.querySelector<HTMLButtonElement>("[data-save-aistudio-button]") ?? null;
      const exportButton = root?.querySelector<HTMLButtonElement>("[data-export-mp4-button]") ?? null;
      const capabilitySummary = root?.querySelector<HTMLElement>("[data-export-capability-summary]") ?? null;
      return {
        rootChildren: root?.childElementCount ?? -1,
        label: root?.querySelector<HTMLElement>(".assets-panel > h2 + p.muted")?.textContent ?? "<missing>",
        projectControls: root?.querySelector("[data-project-file-controls]") !== null,
        timelineEditor: root?.querySelector("[data-timeline-editor]") !== null,
        saveDisabled: saveButton?.disabled ?? null,
        selectedSupported: capabilitySummary?.getAttribute("data-export-selected-supported") ?? null,
        exportDisabled: exportButton?.disabled ?? null,
        exportStatus: root?.querySelector<HTMLElement>("[data-export-mp4-status]")?.textContent ?? "",
      };
    };
    const log = (phase: string, state = snapshot()): void => console.log(`${prefix} ${phase} ${JSON.stringify(state)}`);
    const isPostOpenReady = (state: CompatSnapshot): boolean => {
      if (state.label !== "local-demo-project") return false;
      if (!state.projectControls || !state.timelineEditor || state.saveDisabled !== false) return false;
      if (state.selectedSupported !== "true" && state.selectedSupported !== "false") return false;
      if (state.selectedSupported === "true") return state.exportDisabled === false;
      return state.exportDisabled === true && state.exportStatus.includes("unavailable");
    };

    const installRootObserver = (): void => {
      const root = document.querySelector<HTMLElement>("#app");
      if (root === null || root.dataset.compatDiagObserver === "true") return;
      root.dataset.compatDiagObserver = "true";
      let readyLogged = false;
      const maybeLogReady = (): void => {
        if (readyLogged) return;
        const state = snapshot();
        if (!isPostOpenReady(state)) return;
        readyLogged = true;
        log("post-open-ready", state);
      };
      new MutationObserver((records) => {
        log(`root-mutation records=${records.length}`);
        maybeLogReady();
      }).observe(root, { childList: true, subtree: true, attributes: true });
      log("root-observer-installed");
      maybeLogReady();
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", installRootObserver, { once: true });
    } else {
      installRootObserver();
    }

    const isOpenDemoActivation = (event: Event): boolean => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      return target?.textContent?.trim() === "Open local demo";
    };

    document.addEventListener("click", (event) => {
      if (!isOpenDemoActivation(event)) return;
      log("click-capture-enter");
      window.setTimeout(() => log("capture-sentinel-fired"), 0);
    }, true);

    document.addEventListener("click", (event) => {
      if (!isOpenDemoActivation(event)) return;
      log("click-bubble-returned");
      window.setTimeout(() => log("bubble-sentinel-fired"), 0);
    });
  });

  await page.goto("/");

  const exportButton = page.locator("[data-export-mp4-button]");
  const saveButton = page.locator("[data-save-aistudio-button]");

  await expect(exportButton).toBeVisible();
  await expect(exportButton).toBeDisabled();
  await expect(saveButton).toBeDisabled();

  await page.getByRole("button", { name: "Open local demo" }).click();

  const settled = postOpenSnapshot ?? await new Promise<CompatSnapshot>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Project shell did not settle after pointer activation. pageErrors=${JSON.stringify(pageErrors)} diagnostics=${JSON.stringify(diagnostics)}`));
    }, 5_000);
    postOpenReady.then((snapshot) => {
      clearTimeout(timeout);
      resolve(snapshot);
    }, (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  expect(settled.label).toBe("local-demo-project");
  expect(settled.projectControls).toBe(true);
  expect(settled.timelineEditor).toBe(true);
  expect(settled.saveDisabled).toBe(false);
  expect(["true", "false"]).toContain(settled.selectedSupported);
  if (settled.selectedSupported === "true") {
    expect(settled.exportDisabled).toBe(false);
  } else {
    expect(settled.exportDisabled).toBe(true);
    expect(settled.exportStatus).toContain("unavailable");
  }
});
