import { expect, test } from "@playwright/test";

test("Studio exports a real MP4 preview from the opened demo project", async ({ page }) => {
  await page.goto("/");

  const exportButton = page.locator("[data-export-mp4-button]");
  const exportStatus = page.locator("[data-export-mp4-status]");

  await expect(exportButton).toBeVisible();
  await expect(exportButton).toBeDisabled();
  await expect(exportStatus).toContainText("Open the local demo project");

  await page.getByRole("button", { name: "Open local demo" }).click();
  await expect(exportButton).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("local-demo-project-preview.mp4");
  const stream = await download.createReadStream();
  if (stream === null) throw new Error("MP4 download stream was unavailable.");

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  expect(bytes.byteLength).toBeGreaterThan(1_000);
  expect(bytes.subarray(4, 8).toString("ascii")).toBe("ftyp");

  await expect(exportStatus).toHaveAttribute("data-export-phase", "SUCCESS");
  await expect(exportStatus).toContainText("MP4 ready");
  await expect(page.locator("[data-export-mp4-progress]")).toHaveJSProperty("value", 100);
});
