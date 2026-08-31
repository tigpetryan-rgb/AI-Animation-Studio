import { expect, test, type Page } from "@playwright/test";

async function enableControlledAndroidRuntime(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as {
      AIStudioRuntime?: unknown;
      __savedGeneration?: unknown;
    };
    target.__savedGeneration = null;
    target.AIStudioRuntime = {
      info: { platform: "android", model: "Automated Android Runtime" },
      saveBlob: async (fileName: string, mimeType: string, blob: Blob) => {
        target.__savedGeneration = { fileName, mimeType, size: blob.size, text: await blob.text() };
        return { uri: "content://aistudio/generated-video.mp4", bytesWritten: blob.size, sha256: "a".repeat(64) };
      },
    };
    window.dispatchEvent(new CustomEvent("aistudio:runtime-ready"));
  });
  await expect(page.locator("html")).toHaveClass(/runtime-simple-ui/);
  await expect(page.locator("[data-runtime-chat-shell]")).toBeVisible();
}

async function configureGeneration(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { AIStudioGenerationConfig?: unknown }).AIStudioGenerationConfig = {
      apiBaseUrl: "http://127.0.0.1:4173/mock-generation",
      requestTimeoutMs: 2_000,
      pollIntervalMs: 40,
      maxJobAgeMs: 5_000,
    };
    window.dispatchEvent(new CustomEvent("aistudio:generation-config-ready"));
  });
}

test("chat uploads reference bytes, reports backend progress, previews and saves generated video", async ({ page }) => {
  let postCount = 0;
  let phase: "running" | "processing" | "succeeded" = "running";
  let uploadedBody: Buffer | null = null;

  await page.route("**/mock-generation/v1/video-jobs**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/v1/video-jobs")) {
      postCount += 1;
      uploadedBody = request.postDataBuffer();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId: "job-1", status: "queued", pollAfterMs: 250 }),
      });
      return;
    }
    if (request.method() === "GET" && url.pathname.endsWith("/v1/video-jobs/job-1")) {
      if (phase === "running") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ jobId: "job-1", status: "running", progress: 0.42, pollAfterMs: 180 }),
        });
        return;
      }
      if (phase === "processing") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ jobId: "job-1", status: "processing", message: "Encoding final video", pollAfterMs: 180 }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobId: "job-1",
          status: "succeeded",
          result: {
            videoUrl: "/mock-generation/video.mp4",
            downloadUrl: "/mock-generation/video.mp4",
            mimeType: "video/mp4",
            fileName: "mountain-reveal.mp4",
          },
        }),
      });
      return;
    }
    await route.abort();
  });
  await page.route("**/mock-generation/video.mp4", (route) => route.fulfill({
    status: 200,
    contentType: "video/mp4",
    body: Buffer.from("generated-video-bytes"),
  }));

  await page.goto("/");
  await enableControlledAndroidRuntime(page);
  await configureGeneration(page);

  await page.locator("[data-runtime-file-input]").setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: Buffer.from("synthetic-reference-binary"),
  });
  await page.getByLabel("Message", { exact: true }).fill("Create a cinematic mountain reveal");
  await page.getByLabel("Send message").dblclick();

  const status = page.locator("[data-runtime-generation-status]");
  await expect(status).toHaveAttribute("data-status", "QUEUED");
  expect(postCount).toBe(1);
  expect(uploadedBody).not.toBeNull();
  expect(uploadedBody?.includes(Buffer.from("synthetic-reference-binary"))).toBe(true);
  expect(uploadedBody?.includes(Buffer.from("Create a cinematic mountain reveal"))).toBe(true);

  await expect(status).toHaveAttribute("data-status", "RUNNING");
  await expect(page.locator("[data-runtime-generation-progress]")).toHaveJSProperty("value", 42);

  phase = "processing";
  await expect(status).toHaveAttribute("data-status", "PROCESSING");
  await expect(page.locator("[data-runtime-generation-progress]")).toHaveCount(0);
  await expect(page.locator("[data-runtime-generation-message]")).toHaveText("Encoding final video");

  phase = "succeeded";
  await expect(status).toHaveAttribute("data-status", "SUCCEEDED");
  await expect(page.locator("[data-runtime-generation-video]")).toBeVisible();
  await expect(page.locator("[data-runtime-generation-video]")).toHaveAttribute("src", /mock-generation\/video\.mp4/);
  await expect(page.getByText("Video generation completed.", { exact: true })).toBeVisible();

  await page.locator("[data-runtime-generation-save]").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __savedGeneration?: unknown }).__savedGeneration)).toEqual({
    fileName: "mountain-reveal.mp4",
    mimeType: "video/mp4",
    size: 21,
    text: "generated-video-bytes",
  });
});

test("backend failure has no synthetic percent and retry reuses the real reference file", async ({ page }) => {
  let createCalls = 0;
  let fail = true;
  const uploadedBodies: Buffer[] = [];

  await page.route("**/mock-generation/v1/video-jobs**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/v1/video-jobs")) {
      createCalls += 1;
      const body = request.postDataBuffer();
      if (body !== null) uploadedBodies.push(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fail
          ? { jobId: `job-${createCalls}`, status: "queued", pollAfterMs: 30 }
          : {
              jobId: `job-${createCalls}`,
              status: "succeeded",
              result: { videoUrl: "/mock-generation/video.mp4", mimeType: "video/mp4", fileName: "retry.mp4" },
            }),
      });
      return;
    }
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "failed", message: "Provider rejected reference image" }),
      });
      return;
    }
    await route.abort();
  });

  await page.goto("/");
  await enableControlledAndroidRuntime(page);
  await configureGeneration(page);
  await page.locator("[data-runtime-file-input]").setInputFiles({
    name: "bad-reference.png",
    mimeType: "image/png",
    buffer: Buffer.from("retry-reference-binary"),
  });
  await page.getByLabel("Message", { exact: true }).fill("Animate this reference");
  await page.getByLabel("Send message").click();

  const status = page.locator("[data-runtime-generation-status]");
  await expect(status).toHaveAttribute("data-status", "FAILED");
  await expect(page.locator("[data-runtime-generation-message]")).toHaveText("Provider rejected reference image");
  await expect(page.locator("[data-runtime-generation-progress]")).toHaveCount(0);
  await expect(page.locator("[data-runtime-generation-retry]")).toBeEnabled();

  fail = false;
  await page.locator("[data-runtime-generation-retry]").click();
  await expect(status).toHaveAttribute("data-status", "SUCCEEDED");
  expect(createCalls).toBe(2);
  expect(uploadedBodies).toHaveLength(2);
  expect(uploadedBodies[1]?.includes(Buffer.from("retry-reference-binary"))).toBe(true);
});

test("background job status stays bound to its chat and a running job resumes after reload", async ({ page }) => {
  let getCalls = 0;
  let complete = false;

  await page.route("**/mock-generation/v1/video-jobs**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/v1/video-jobs")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jobId: "resume-1", status: "queued", pollAfterMs: 40 }) });
      return;
    }
    if (request.method() === "GET" && url.pathname.endsWith("/resume-1")) {
      getCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(complete
          ? { status: "succeeded", result: { videoUrl: "/mock-generation/video.mp4", mimeType: "video/mp4", fileName: "resumed.mp4" } }
          : { status: "running", message: "Provider is rendering", pollAfterMs: 40 }),
      });
      return;
    }
    await route.abort();
  });

  await page.goto("/");
  await enableControlledAndroidRuntime(page);
  await configureGeneration(page);
  await page.getByLabel("Message", { exact: true }).fill("Long running generation");
  await page.getByLabel("Send message").click();
  const status = page.locator("[data-runtime-generation-status]");
  await expect(status).toHaveAttribute("data-status", "RUNNING");

  await page.getByLabel("Open chats menu").click();
  await page.getByRole("button", { name: /New chat/ }).click();
  await expect(status).toBeHidden();

  await page.reload();
  await enableControlledAndroidRuntime(page);
  await configureGeneration(page);
  complete = true;

  await page.getByLabel("Open chats menu").click();
  await page.getByRole("button", { name: "Long running generation", exact: true }).click();
  await expect(status).toHaveAttribute("data-status", "SUCCEEDED");
  expect(getCalls).toBeGreaterThan(0);
});

test("queued job can be cancelled and polling stops at the cancelled terminal state", async ({ page }) => {
  let cancelCalls = 0;

  await page.route("**/mock-generation/v1/video-jobs**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/v1/video-jobs")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jobId: "cancel-1", status: "queued", pollAfterMs: 1_000 }) });
      return;
    }
    if (request.method() === "POST" && url.pathname.endsWith("/cancel-1/cancel")) {
      cancelCalls += 1;
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    if (request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "running" }) });
      return;
    }
    await route.abort();
  });

  await page.goto("/");
  await enableControlledAndroidRuntime(page);
  await configureGeneration(page);
  await page.getByLabel("Message", { exact: true }).fill("Cancel this generation");
  await page.getByLabel("Send message").click();

  const status = page.locator("[data-runtime-generation-status]");
  await expect(status).toHaveAttribute("data-status", "QUEUED");
  await page.locator("[data-runtime-generation-cancel]").click();
  await expect(status).toHaveAttribute("data-status", "CANCELLED");
  expect(cancelCalls).toBe(1);
});

test("job age timeout becomes a visible failure instead of synthetic progress", async ({ page }) => {
  await page.route("**/mock-generation/v1/video-jobs**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/v1/video-jobs")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jobId: "timeout-1", status: "queued", pollAfterMs: 70 }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "running", pollAfterMs: 70 }) });
  });

  await page.goto("/");
  await enableControlledAndroidRuntime(page);
  await page.evaluate(() => {
    (window as unknown as { AIStudioGenerationConfig?: unknown }).AIStudioGenerationConfig = {
      apiBaseUrl: "http://127.0.0.1:4173/mock-generation",
      requestTimeoutMs: 2_000,
      pollIntervalMs: 70,
      maxJobAgeMs: 120,
    };
  });
  await page.getByLabel("Message", { exact: true }).fill("Timeout this generation");
  await page.getByLabel("Send message").click();

  const status = page.locator("[data-runtime-generation-status]");
  await expect(status).toHaveAttribute("data-status", "FAILED");
  await expect(page.locator("[data-runtime-generation-message]")).toContainText("timed out");
  await expect(page.locator("[data-runtime-generation-progress]")).toHaveCount(0);
});

test("missing production endpoint fails visibly without sending provider credentials from the client", async ({ page }) => {
  await page.goto("/");
  await enableControlledAndroidRuntime(page);
  await page.getByLabel("Message", { exact: true }).fill("Create a production video");
  await page.getByLabel("Send message").click();

  const status = page.locator("[data-runtime-generation-status]");
  await expect(status).toHaveAttribute("data-status", "FAILED");
  await expect(page.locator("[data-runtime-generation-message]")).toContainText("not configured");
  await expect(page.locator("[data-runtime-generation-message]")).toContainText("credentials must remain server-side");
});
