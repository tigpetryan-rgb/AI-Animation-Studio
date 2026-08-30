import { expect, test } from "@playwright/test";

test("Studio edits, reopens, capability-checks, cancels, and disk-streams MP4", async ({ page }) => {
  test.setTimeout(90_000);

  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes("/demo-media/")) mediaRequests.push(url.pathname);
  });

  await page.goto("/");

  const exportButton = page.locator("[data-export-mp4-button]");
  const cancelButton = page.locator("[data-cancel-export-button]");
  const saveButton = page.locator("[data-save-aistudio-button]");
  const exportStatus = page.locator("[data-export-mp4-status]");
  const timelineSummary = page.locator("[data-export-timeline-summary]");
  const planSummary = page.locator("[data-export-plan-summary]");
  const capabilitySummary = page.locator("[data-export-capability-summary]");
  const resolution = page.locator("[data-export-resolution-select]");
  const frameRate = page.locator("[data-export-frame-rate-select]");
  const quality = page.locator("[data-export-quality-select]");
  const audioBitrate = page.locator("[data-export-audio-bitrate-select]");
  const projectStatus = page.locator("[data-project-file-status]");

  await expect(exportButton).toBeVisible();
  await expect(exportButton).toBeDisabled();
  await expect(saveButton).toBeDisabled();
  await expect(page.locator("[data-open-aistudio-button]")).toBeVisible();

  await page.getByRole("button", { name: "Open local demo" }).click();

  await expect(exportButton).toBeEnabled({ timeout: 15_000 });
  await expect(saveButton).toBeEnabled();
  await expect(resolution).toHaveValue("source");
  await expect(frameRate).toHaveValue("source");
  await expect(quality).toHaveValue("balanced");
  await expect(audioBitrate).toHaveValue("96");
  await expect(planSummary).toHaveAttribute("data-export-width", "320");
  await expect(planSummary).toHaveAttribute("data-export-height", "180");
  await expect(planSummary).toHaveAttribute("data-export-frame-rate", "12");
  await expect(planSummary).toHaveAttribute("data-export-storage-mode", "streaming");
  await expect(planSummary).toHaveAttribute("data-export-blocked", "false");
  await expect(capabilitySummary).toHaveAttribute("data-export-opus-supported", "true", { timeout: 15_000 });
  await expect(capabilitySummary).toHaveAttribute("data-export-selected-supported", "true");
  await expect(resolution.locator("option[value='source']")).toHaveAttribute("data-codec-supported", "true");
  await expect(frameRate.locator("option[value='source']")).toHaveAttribute("data-codec-supported", "true");
  await expect(timelineSummary).toHaveAttribute("data-timeline-id", "local-demo-timeline");
  await expect(timelineSummary).toHaveAttribute("data-timeline-duration-seconds", "4");
  await expect(timelineSummary).toHaveAttribute("data-image-asset-count", "1");
  await expect(timelineSummary).toHaveAttribute("data-video-asset-count", "1");
  await expect(timelineSummary).toHaveAttribute("data-audio-asset-count", "2");

  const editor = page.locator("[data-timeline-editor]");
  const previewStatus = page.locator("[data-timeline-preview-status]");
  await expect(editor).toBeVisible();
  await expect(page.locator("[data-timeline-track-id='picture']")).toBeVisible();
  await expect(page.locator("[data-timeline-track-id='dialogue-music']")).toBeVisible();
  await expect(page.locator("[data-timeline-clip-id='opening-shot']")).toBeVisible();
  await expect(page.locator("[data-timeline-clip-id='action-shot']")).toBeVisible();
  await expect(previewStatus).toHaveAttribute("data-preview-phase", "READY", { timeout: 15_000 });
  await expect(previewStatus).toContainText("Opening shot");
  await expect(previewStatus).toContainText("Opening audio");

  await page.locator("[data-timeline-clip-id='action-shot']").click();
  await expect(page.locator("[data-timeline-selection]")).toContainText("action-shot");
  await expect(previewStatus).toContainText("Action video", { timeout: 15_000 });
  await expect(previewStatus).toContainText("Action audio");

  await page.locator("[data-timeline-edit-action='slip-forward']").click();
  await expect(page.locator("[data-timeline-selection]")).toContainText("source 0.58s");

  const assetSelect = page.locator("[data-relink-asset-select]");
  await assetSelect.selectOption("visual-opening");
  const replacementSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#263238"/><circle cx="160" cy="90" r="54" fill="#fafafa"/></svg>',
  );
  await page.locator("[data-relink-media-input]").setInputFiles({
    name: "replacement-opening.svg",
    mimeType: "image/svg+xml",
    buffer: replacementSvg,
  });
  await expect(projectStatus).toHaveAttribute("data-relinked-asset-id", "visual-opening");
  await expect(projectStatus).toContainText("Relinked Opening shot");
  await expect(previewStatus).toHaveAttribute("data-preview-phase", "READY", { timeout: 15_000 });

  const projectDownloadPromise = page.waitForEvent("download");
  await saveButton.click();
  const projectDownload = await projectDownloadPromise;
  expect(projectDownload.suggestedFilename()).toBe("local-demo-movie.aistudio");
  const projectPath = await projectDownload.path();
  if (projectPath === null) throw new Error(".aistudio download path was unavailable.");
  const projectStream = await projectDownload.createReadStream();
  if (projectStream === null) throw new Error(".aistudio download stream was unavailable.");
  const projectChunks: Buffer[] = [];
  for await (const chunk of projectStream) projectChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const projectBytes = Buffer.concat(projectChunks);
  expect(projectBytes.byteLength).toBeGreaterThan(1_000);
  expect(projectBytes.subarray(0, 4).toString("hex")).toBe("504b0304");
  await expect(exportStatus).toContainText("Editable .aistudio saved");

  await page.locator("[data-open-aistudio-input]").setInputFiles(projectPath);
  await expect(projectStatus).toContainText("Reopened", { timeout: 15_000 });
  await expect(previewStatus).toHaveAttribute("data-preview-phase", "READY", { timeout: 15_000 });
  await expect(exportButton).toBeEnabled({ timeout: 15_000 });

  await page.locator("[data-timeline-clip-id='action-shot']").click();
  await expect(page.locator("[data-timeline-selection]")).toContainText("source 0.58s");

  // Cancel a real disk-streamed source-profile encode while media preparation/fragment writing is active.
  await exportButton.click();
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>("[data-cancel-export-button]");
    if (button === null || button.hidden || button.disabled) throw new Error("Cancel export button is not actionable.");
    button.click();
  });
  await expect(exportStatus).toHaveAttribute("data-export-phase", "CANCELLED", { timeout: 15_000 });
  await expect(exportStatus).toContainText("No MP4 was downloaded");
  await expect(cancelButton).toBeHidden();
  await expect(exportButton).toBeEnabled({ timeout: 15_000 });

  // A cancelled disk-backed job must not poison the next export.
  const mp4DownloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await exportButton.click();
  const mp4Download = await mp4DownloadPromise;

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
  expect(mp4Bytes.includes(Buffer.from("moov"))).toBe(true);
  expect(mp4Bytes.includes(Buffer.from("moof"))).toBe(true);
  expect(mp4Bytes.includes(Buffer.from("mdat"))).toBe(true);

  const playback = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
    const video = document.createElement("video");
    video.muted = true;
    video.src = url;
    video.playsInline = true;
    document.body.append(video);
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Fragmented MP4 metadata timed out.")), 10_000);
        video.addEventListener("loadedmetadata", () => {
          window.clearTimeout(timeout);
          resolve();
        }, { once: true });
        video.addEventListener("error", () => {
          window.clearTimeout(timeout);
          reject(new Error(video.error?.message ?? "Fragmented MP4 playback failed."));
        }, { once: true });
      });
      await video.play();
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      return { width: video.videoWidth, height: video.videoHeight, readyState: video.readyState };
    } finally {
      video.pause();
      video.remove();
      URL.revokeObjectURL(url);
    }
  }, mp4Bytes.toString("base64"));
  expect(playback.width).toBe(320);
  expect(playback.height).toBe(180);
  expect(playback.readyState).toBeGreaterThanOrEqual(2);

  await expect(exportStatus).toHaveAttribute("data-export-phase", "SUCCESS");
  await expect(exportStatus).toContainText("MP4 ready");
  await expect(exportStatus).toContainText("320×180 @ 12 fps");
  await expect(exportStatus).toContainText("disk-streamed");
  await expect(exportStatus).toContainText("fragments");
  await expect(exportStatus).toContainText("shared Preview/Export renderer");
  await expect(exportStatus).toContainText("1 decoded image");
  await expect(exportStatus).toContainText("1 decoded video");
  await expect(exportStatus).toContainText("2 decoded audio");
  await expect(page.locator("[data-export-mp4-progress]")).toHaveJSProperty("value", 100);
});
