import { expect, test } from "@playwright/test";

test("Studio opens projects and gates export safely on this browser profile", async ({ page }) => {
  await page.goto("/");

  const exportButton = page.locator("[data-export-mp4-button]");
  const saveButton = page.locator("[data-save-aistudio-button]");
  const capabilitySummary = page.locator("[data-export-capability-summary]");

  await expect(exportButton).toBeVisible();
  await expect(exportButton).toBeDisabled();
  await expect(saveButton).toBeDisabled();

  await page.getByRole("button", { name: "Open local demo" }).click();

  await expect(page.locator("[data-timeline-editor]")).toBeVisible();
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
