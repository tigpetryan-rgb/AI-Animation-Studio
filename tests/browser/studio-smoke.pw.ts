import { expect, test, type Page } from "@playwright/test";

async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
    });
  });
}

async function currentBuildCommit(page: Page): Promise<string> {
  const commit = await page.locator("[data-studio-build-commit]").getAttribute("data-studio-build-commit");
  if (!commit) throw new Error("Studio build commit is unavailable in the Runtime inspector.");
  return commit;
}

function importedReport(
  buildCommit: string,
  options: { omitOpfs?: boolean } = {},
): string {
  const checks = [
    { id: "secure-context", label: "Secure Context", required: true, status: "PASS", detail: "ok", durationMs: 1 },
    { id: "service-worker", label: "Service Worker", required: true, status: "PASS", detail: "ok", durationMs: 1 },
    { id: "opfs", label: "OPFS", required: true, status: "PASS", detail: "ok", durationMs: 1 },
    { id: "indexeddb", label: "IndexedDB", required: true, status: "PASS", detail: "ok", durationMs: 1 },
    { id: "wasm", label: "WebAssembly", required: true, status: "PASS", detail: "ok", durationMs: 1 },
    { id: "webgpu", label: "WebGPU Adapter", required: false, status: "PASS", detail: "ok", durationMs: 1 },
    { id: "webcodecs", label: "WebCodecs VP8", required: false, status: "PASS", detail: "ok", durationMs: 1 },
  ].filter((check) => !(options.omitOpfs && check.id === "opfs"));

  return JSON.stringify({
    schemaVersion: 2,
    build: {
      repository: "tigpetryan-rgb/AI-Animation-Studio",
      commit: buildCommit,
      sourceDate: "2026-08-29T11:00:00.000Z",
    },
    capturedAt: "2026-08-29T11:00:00.000Z",
    userAgent: "M23 imported Android browser report",
    summary: "READY",
    checks,
    note: "Imported test evidence",
  });
}

test("Studio boots and accepts real UI interactions", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("AI Animation Studio");
  await expect(page.getByText("AI Animation Studio", { exact: true })).toBeVisible();
  await expect(page.getByText("Production viewport")).toBeVisible();

  const buildCommit = await currentBuildCommit(page);
  expect(buildCommit).toMatch(/^[0-9a-f]{40}$/);

  await page.getByRole("button", { name: "QC", exact: true }).click();
  await expect(page.locator(".eyebrow")).toHaveText("QC");

  await page.getByRole("button", { name: "Open local demo" }).click();
  await expect(page.getByText("local-demo-project", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Project open" })).toBeDisabled();
});

test("Chromium executes Service Worker and OPFS read/write", async ({ page }) => {
  await page.goto("/");

  const runtime = await page.evaluate(() => ({
    secureContext: window.isSecureContext,
    serviceWorker: "serviceWorker" in navigator,
    opfs: typeof navigator.storage?.getDirectory === "function",
    indexedDb: "indexedDB" in window,
  }));

  expect(runtime.secureContext).toBe(true);
  expect(runtime.serviceWorker).toBe(true);
  expect(runtime.opfs).toBe(true);
  expect(runtime.indexedDb).toBe(true);

  await waitForServiceWorkerControl(page);

  const opfsResult = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("aistudio-smoke.txt", { create: true });
    const writable = await handle.createWritable();
    await writable.write("opfs-ok");
    await writable.close();

    const text = await (await handle.getFile()).text();
    await root.removeEntry("aistudio-smoke.txt");
    return text;
  });

  expect(opfsResult).toBe("opfs-ok");
});

test("installed shell reloads while Chromium is offline", async ({ page, context }) => {
  await page.goto("/");
  await waitForServiceWorkerControl(page);

  await page.reload();
  await expect(page.getByText("Production viewport")).toBeVisible();

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("AI Animation Studio");
    await expect(page.getByText("Production viewport")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("Studio produces a real device verification report bound to its build", async ({ page }) => {
  await page.goto("/");
  const buildCommit = await currentBuildCommit(page);
  await page.getByRole("button", { name: "Run device check" }).click();

  const summary = page.locator(".device-summary");
  await expect(summary).toBeVisible({ timeout: 20_000 });
  expect(["READY", "DEGRADED"]).toContain(await summary.getAttribute("data-summary"));

  await expect(page.locator('[data-check-id="secure-context"] strong')).toHaveText("PASS");
  await expect(page.locator('[data-check-id="service-worker"] strong')).toHaveText("PASS");
  await expect(page.locator('[data-check-id="opfs"] strong')).toHaveText("PASS");
  await expect(page.locator('[data-check-id="indexeddb"] strong')).toHaveText("PASS");
  await expect(page.locator('[data-check-id="wasm"] strong')).toHaveText("PASS");
  await expect(page.getByText(`Build ${buildCommit.slice(0, 12)}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download verification report" })).toBeVisible();
});

test("Studio imports and classifies a valid report from the same build", async ({ page }) => {
  await page.goto("/");
  const buildCommit = await currentBuildCommit(page);
  await page.locator('input[data-device-report-input="true"]').setInputFiles({
    name: "android-device-report.json",
    mimeType: "application/json",
    buffer: Buffer.from(importedReport(buildCommit)),
  });

  await expect(page.getByText("Imported report", { exact: true })).toBeVisible();
  await expect(page.locator('[data-compatibility-mode="FULL"]')).toHaveText("Compatibility: FULL");
  await expect(page.getByText(`Build ${buildCommit.slice(0, 12)}`, { exact: true })).toBeVisible();
  await expect(page.getByText("Required 5/5", { exact: true })).toBeVisible();
  await expect(page.getByText("Optional 2/2", { exact: true })).toBeVisible();
  await expect(page.getByText("M23 imported Android browser report", { exact: true })).toBeVisible();
});

test("Studio rejects an incomplete imported device report", async ({ page }) => {
  await page.goto("/");
  const buildCommit = await currentBuildCommit(page);
  await page.locator('input[data-device-report-input="true"]').setInputFiles({
    name: "invalid-device-report.json",
    mimeType: "application/json",
    buffer: Buffer.from(importedReport(buildCommit, { omitOpfs: true })),
  });

  await expect(page.getByRole("alert")).toContainText("Missing required canonical check: opfs.");
  await expect(page.locator(".compatibility-mode")).toHaveCount(0);
});

test("Studio rejects device evidence produced by a different build", async ({ page }) => {
  await page.goto("/");
  const buildCommit = await currentBuildCommit(page);
  const mismatchedCommit =
    buildCommit === "3333333333333333333333333333333333333333"
      ? "4444444444444444444444444444444444444444"
      : "3333333333333333333333333333333333333333";

  await page.locator('input[data-device-report-input="true"]').setInputFiles({
    name: "wrong-build-device-report.json",
    mimeType: "application/json",
    buffer: Buffer.from(importedReport(mismatchedCommit)),
  });

  await expect(page.getByRole("alert")).toContainText("does not match running Studio build");
  await expect(page.locator(".compatibility-mode")).toHaveCount(0);
});
