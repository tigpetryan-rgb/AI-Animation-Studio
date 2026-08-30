import { expect, test } from "@playwright/test";

async function activateSelfReplacingControl(locator: import("@playwright/test").Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();
  await locator.evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) throw new Error("Expected a button control.");
    element.click();
  });
}

test("Studio opens projects and gates export safely on this browser profile", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(`${error.name}: ${error.message}`));

  await page.goto("/");

  const exportButton = page.locator("[data-export-mp4-button]");
  const saveButton = page.locator("[data-save-aistudio-button]");
  const capabilitySummary = page.locator("[data-export-capability-summary]");

  await expect(exportButton).toBeVisible();
  await expect(exportButton).toBeDisabled();
  await expect(saveButton).toBeDisabled();

  // These controls synchronously replace their own DOM subtree. DOM activation verifies the
  // application click handler without relying on engine-specific pointer-action bookkeeping
  // after the target node has been removed.
  await activateSelfReplacingControl(page.getByRole("button", { name: "Open local demo" }));

  const projectLabel = page.locator(".assets-panel > p.muted");
  try {
    await expect(projectLabel).toHaveText("local-demo-project", { timeout: 5_000 });
  } catch (error) {
    const snapshot = await page.evaluate(() => {
      const assets = document.querySelector<HTMLElement>(".assets-panel");
      const project = assets?.querySelector<HTMLElement>(":scope > p.muted") ?? null;
      const projectButton = Array.from(assets?.querySelectorAll<HTMLButtonElement>(":scope > button") ?? [])
        .find((button) => button.textContent?.includes("Project") || button.textContent?.includes("Open")) ?? null;
      return {
        projectText: project?.textContent ?? null,
        projectOuterHtml: project?.outerHTML ?? null,
        projectButtonText: projectButton?.textContent ?? null,
        projectButtonDisabled: projectButton?.disabled ?? null,
        assetsText: assets?.textContent ?? null,
        assetsHtml: assets?.innerHTML ?? null,
        readyState: document.readyState,
      };
    });
    throw new Error(`Project shell did not settle after activation. pageErrors=${JSON.stringify(pageErrors)} snapshot=${JSON.stringify(snapshot)}`, { cause: error });
  }

  const projectControls = page.locator("[data-project-file-controls]");
  try {
    await expect(projectControls).toBeVisible({ timeout: 5_000 });
  } catch (error) {
    const snapshot = await page.evaluate(() => ({
      projectText: document.querySelector(".assets-panel > p.muted")?.textContent ?? null,
      exportSummary: document.querySelector("[data-export-timeline-summary]")?.textContent ?? null,
      exportStatus: document.querySelector("[data-export-mp4-status]")?.textContent ?? null,
      scripts: Array.from(document.scripts).map((script) => script.src || "inline"),
    }));
    throw new Error(`Timeline sidecar did not install. pageErrors=${JSON.stringify(pageErrors)} snapshot=${JSON.stringify(snapshot)}`, { cause: error });
  }

  try {
    await expect(page.locator("[data-timeline-editor]")).toBeVisible({ timeout: 10_000 });
  } catch (error) {
    const snapshot = await page.evaluate(() => ({
      projectText: document.querySelector(".assets-panel > p.muted")?.textContent ?? null,
      projectControls: document.querySelector("[data-project-file-controls]") !== null,
      exportSummary: document.querySelector("[data-export-timeline-summary]")?.textContent ?? null,
      exportTimelineId: document.querySelector<HTMLElement>("[data-export-timeline-summary]")?.dataset.timelineId ?? null,
      exportStatus: document.querySelector("[data-export-mp4-status]")?.textContent ?? null,
    }));
    throw new Error(`Timeline session did not attach. pageErrors=${JSON.stringify(pageErrors)} snapshot=${JSON.stringify(snapshot)}`, { cause: error });
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

  await activateSelfReplacingControl(page.locator("[data-timeline-clip-id='action-shot']"));
  await expect(page.locator("[data-timeline-selection]")).toContainText("action-shot");
});
