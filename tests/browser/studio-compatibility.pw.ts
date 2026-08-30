import { expect, test } from "@playwright/test";

test("Studio opens projects and gates export safely on this browser profile", async ({ page }) => {
  const pageErrors: string[] = [];
  const diagnostics: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(`${error.name}: ${error.message}`));
  page.on("console", (message) => {
    const value = message.text();
    if (!value.startsWith("[aistudio-compat-diag]")) return;
    diagnostics.push(value);
    console.log(value);
  });

  await page.addInitScript(() => {
    const prefix = "[aistudio-compat-diag]";
    const snapshot = (): string => {
      const root = document.querySelector<HTMLElement>("#app");
      const label = root?.querySelector<HTMLElement>(".assets-panel > p.muted")?.textContent ?? "<missing>";
      return `rootChildren=${root?.childElementCount ?? -1} label=${JSON.stringify(label)}`;
    };
    const log = (phase: string): void => console.log(`${prefix} ${phase} ${snapshot()}`);

    const installRootObserver = (): void => {
      const root = document.querySelector<HTMLElement>("#app");
      if (root === null || root.dataset.compatDiagObserver === "true") return;
      root.dataset.compatDiagObserver = "true";
      new MutationObserver((records) => {
        log(`root-child-mutation records=${records.length}`);
      }).observe(root, { childList: true });
      log("root-observer-installed");
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
  const capabilitySummary = page.locator("[data-export-capability-summary]");

  await expect(exportButton).toBeVisible();
  await expect(exportButton).toBeDisabled();
  await expect(saveButton).toBeDisabled();

  await page.getByRole("button", { name: "Open local demo" }).click();

  const projectLabel = page.locator(".assets-panel > p.muted");
  try {
    await expect(projectLabel).toHaveText("local-demo-project", { timeout: 5_000 });
  } catch (error) {
    throw new Error(`Project shell did not settle after pointer activation. pageErrors=${JSON.stringify(pageErrors)} diagnostics=${JSON.stringify(diagnostics)}`, { cause: error });
  }

  const projectControls = page.locator("[data-project-file-controls]");
  try {
    await expect(projectControls).toBeVisible({ timeout: 5_000 });
  } catch (error) {
    throw new Error(`Timeline sidecar did not install. pageErrors=${JSON.stringify(pageErrors)} diagnostics=${JSON.stringify(diagnostics)}`, { cause: error });
  }

  try {
    await expect(page.locator("[data-timeline-editor]")).toBeVisible({ timeout: 10_000 });
  } catch (error) {
    throw new Error(`Timeline session did not attach. pageErrors=${JSON.stringify(pageErrors)} diagnostics=${JSON.stringify(diagnostics)}`, { cause: error });
  }

  await expect(saveButton).toBeEnabled();
  await expect(capabilitySummary).toHaveAttribute("data-export-opus-supported", /^(true|false)$/);
  await expect(capabilitySummary).toHaveAttribute("data-export-aac-supported", /^(true|false)$/);
  await expect(capabilitySummary).toHaveAttribute("data-export-selected-supported", /^(true|false)$/);

  const selectedSupported = await capabilitySummary.getAttribute("data-export-selected-supported");
  if (selectedSupported === "true") {
    await expect(exportButton).toBeEnabled();
  } else {
    await expect(exportButton).toBeDisabled();
    await expect(page.locator("[data-export-mp4-status]")).toContainText("unavailable");
  }

  await page.locator("[data-timeline-clip-id='action-shot']").click();
  await expect(page.locator("[data-timeline-selection]")).toContainText("action-shot");
});
