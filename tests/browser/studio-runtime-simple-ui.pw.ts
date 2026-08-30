import { expect, test, type Page } from "@playwright/test";

async function enableControlledAndroidRuntime(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { AIStudioRuntime?: unknown }).AIStudioRuntime = {
      info: {
        platform: "android",
        model: "Automated Android Runtime",
      },
    };
    window.dispatchEvent(new CustomEvent("aistudio:runtime-ready"));
  });
  await expect(page.locator("html")).toHaveClass(/runtime-simple-ui/);
  await expect(page.locator("[data-runtime-chat-shell]")).toBeVisible();
}

test("plain Web Studio does not expose Android-only chat shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveClass(/runtime-simple-ui/);
  await expect(page.locator("[data-runtime-chat-shell]")).toHaveCount(0);
  await expect(page.getByText("Production viewport", { exact: true })).toBeVisible();
});

test("controlled Android Runtime is chat-first and hides technical Studio panels", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await enableControlledAndroidRuntime(page);

  await expect(page.getByText("What do you want to create?", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Add media")).toBeVisible();
  await expect(page.getByLabel("Chat menu")).toBeVisible();
  await expect(page.getByLabel("Open chats menu")).toBeVisible();
  await expect(page.locator(".studio-frame")).toBeHidden();

  for (const selector of [
    "[data-runtime-chat-menu]",
    "[data-runtime-left-menu]",
    "[data-runtime-attach]",
    "[data-runtime-send]",
  ]) {
    const box = await page.locator(selector).boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  const drawerLauncherBox = await page.getByLabel("Open chats menu").boundingBox();
  expect(drawerLauncherBox).not.toBeNull();
  expect(drawerLauncherBox?.x ?? Number.MAX_SAFE_INTEGER).toBeLessThanOrEqual(20);
  expect(drawerLauncherBox?.y ?? Number.MAX_SAFE_INTEGER).toBeLessThanOrEqual(20);
});

test("chat composer accepts prompt plus media and emits one orchestration event", async ({ page }) => {
  await page.goto("/");
  await enableControlledAndroidRuntime(page);

  await page.evaluate(() => {
    (window as unknown as { __chatSubmit?: unknown }).__chatSubmit = null;
    window.addEventListener("aistudio:chat-submit", (event) => {
      const detail = (event as CustomEvent).detail as {
        prompt?: string;
        files?: File[];
        media?: Array<{ name?: string; type?: string }>;
      };
      (window as unknown as { __chatSubmit?: unknown }).__chatSubmit = {
        prompt: detail.prompt,
        fileNames: detail.files?.map((file) => file.name),
        media: detail.media,
      };
    }, { once: true });
  });

  await page.locator("[data-runtime-file-input]").setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: Buffer.from("synthetic-image"),
  });
  await expect(page.getByText("reference.png", { exact: true })).toBeVisible();

  await page.getByLabel("Message", { exact: true }).fill("Create a cinematic mountain reveal");
  await page.getByLabel("Send message").click();

  await expect(page.getByText("Create a cinematic mountain reveal", { exact: true })).toBeVisible();
  await expect(page.locator("[data-runtime-message=\"user\"]").getByText("reference.png", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");

  const submitted = await page.evaluate(() => (window as unknown as { __chatSubmit?: unknown }).__chatSubmit);
  expect(submitted).toMatchObject({
    prompt: "Create a cinematic mountain reveal",
    fileNames: ["reference.png"],
    media: [{ name: "reference.png", type: "image/png" }],
  });
});

test("chat action menu exposes media results favorites project and archive", async ({ page }) => {
  await page.goto("/");
  await enableControlledAndroidRuntime(page);

  await page.getByLabel("Chat menu").click();
  const menu = page.getByLabel("Chat actions");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: /Media in this chat/ })).toBeVisible();
  await expect(menu.getByRole("button", { name: /Results/ })).toBeVisible();
  await expect(menu.getByRole("button", { name: /Add to favorites/ })).toBeVisible();
  await expect(menu.getByRole("button", { name: /Add to project/ })).toBeVisible();
  await expect(menu.getByRole("button", { name: /Archive chat/ })).toBeVisible();

  await menu.getByRole("button", { name: /Add to favorites/ }).click();
  await expect(menu.getByRole("button", { name: /Remove from favorites/ })).toBeVisible();
});

test("left drawer contains new chat history projects creation and archive", async ({ page }) => {
  await page.goto("/");
  await enableControlledAndroidRuntime(page);

  await page.getByLabel("Message", { exact: true }).fill("First saved conversation");
  await page.getByLabel("Send message").click();
  await page.getByLabel("Open chats menu").click();

  const drawer = page.getByLabel("Chats and projects");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: /New chat/ })).toBeVisible();
  await expect(drawer.getByText("Recent chats", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "First saved conversation", exact: true })).toBeVisible();
  await expect(drawer.getByText("Projects", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /Create new project/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Archive", exact: true })).toBeVisible();

  await drawer.getByRole("button", { name: /Create new project/ }).click();
  await drawer.getByLabel("Project name").fill("Film One");
  await drawer.getByRole("button", { name: "Create", exact: true }).click();
  await expect(drawer.getByRole("button", { name: /Film One/ })).toBeVisible();
});

test("hidden internal advanced mode keeps production engine testable without exposing it in chat UI", async ({ page }) => {
  await page.goto("/");
  await enableControlledAndroidRuntime(page);
  await expect(page.getByText("Advanced controls", { exact: true })).toHaveCount(0);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aistudio:runtime-show-advanced")));
  await expect(page.locator("html")).toHaveClass(/runtime-advanced-ui/);
  await expect(page.locator("[data-runtime-chat-shell]")).toBeHidden();
  await expect(page.locator(".studio-frame")).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aistudio:runtime-show-chat")));
  await expect(page.locator("html")).toHaveClass(/runtime-simple-ui/);
  await expect(page.locator("[data-runtime-chat-shell]")).toBeVisible();
});
