import { expect, test } from "@playwright/test";

test("Studio decodes image, video and audio media, exports MP4, and saves editable project", async ({ page }) => {
  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes("/demo-media/")) mediaRequests.push(url.pathname);
  });

  await page.goto("/");

  const exportButton = page.locator("[data-export-mp4-button]");
  const saveButton = page.locator("[data-save-aistudio-button]");
  const exportStatus = page.locator("[data-export-mp4-status]");
  const timelineSummary = page.locator("[data-export-timeline-summary]");

  await expect(exportButton).toBeVisible();
  await expect(exportButton).toBeDisabled();
  await expect(saveButton).toBeDisabled();
  await expect(exportStatus).toContainText("Open the local demo project");

  await page.getByRole("button", { name: "Open local demo" }).click();
  await expect(exportButton).toBeEnabled();
  await expect(saveButton).toBeEnabled();
  await expect(exportButton).toHaveText("Export media MP4");
  await expect(timelineSummary).toHaveAttribute("data-timeline-id", "local-demo-timeline");
  await expect(timelineSummary).toHaveAttribute("data-timeline-duration-seconds", "4");
  await expect(timelineSummary).toHaveAttribute("data-image-asset-count", "1");
  await expect(timelineSummary).toHaveAttribute("data-video-asset-count", "1");
  await expect(timelineSummary).toHaveAttribute("data-audio-asset-count", "2");
  await expect(timelineSummary).toContainText("2 video clips");
  await expect(timelineSummary).toContainText("2 audio clips");

  const mp4DownloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const mp4Download = await mp4DownloadPromise;

  expect(mediaRequests).toContain("/demo-media/opening-shot.svg");
  expect(mediaRequests).toContain("/demo-media/action-shot.webm.b64");
  expect(mediaRequests).toContain("/demo-media/opening-tone.ogg.b64");
  expect(mediaRequests).toContain("/demo-media/action-tone.ogg.b64");
  expect(mp4Download.suggestedFilename()).toBe("local-demo-project-timeline.mp4");
  const mp4Stream = await mp4Download.createReadStream();
  if (mp4Stream === null) throw new Error("MP4 download stream was unavailable.");

  const mp4Chunks: Buffer[] = [];
  for await (const chunk of mp4Stream) mp4Chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const mp4Bytes = Buffer.concat(mp4Chunks);
  expect(mp4Bytes.byteLength).toBeGreaterThan(1_000);
  expect(mp4Bytes.subarray(4, 8).toString("ascii")).toBe("ftyp");

  await expect(exportStatus).toHaveAttribute("data-export-phase", "SUCCESS");
  await expect(exportStatus).toContainText("MP4 ready");
  await expect(exportStatus).toContainText("1 decoded image");
  await expect(exportStatus).toContainText("1 decoded video");
  await expect(exportStatus).toContainText("2 decoded audio");
  await expect(page.locator("[data-export-mp4-progress]")).toHaveJSProperty("value", 100);

  const projectDownloadPromise = page.waitForEvent("download");
  await saveButton.click();
  const projectDownload = await projectDownloadPromise;
  expect(projectDownload.suggestedFilename()).toBe("local-demo-movie.aistudio");
  const projectStream = await projectDownload.createReadStream();
  if (projectStream === null) throw new Error(".aistudio download stream was unavailable.");
  const projectChunks: Buffer[] = [];
  for await (const chunk of projectStream) projectChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const projectBytes = Buffer.concat(projectChunks);
  expect(projectBytes.byteLength).toBeGreaterThan(1_000);
  expect(projectBytes.subarray(0, 4).toString("hex")).toBe("504b0304");
  await expect(exportStatus).toContainText("Editable .aistudio saved");
});
