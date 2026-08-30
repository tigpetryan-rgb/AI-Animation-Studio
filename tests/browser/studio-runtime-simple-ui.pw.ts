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
}

test("plain Web Studio does not expose Android-only simple navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveClass(/runtime-simple-ui/);
  await expect(page.locator("[data-runtime-simple-menu]")).toHaveCount(0);
  await expect(page.getByText("Production viewport", { exact: true })).toBeVisible();
});

test("controlled Android Runtime exposes touch-safe Runway-style drawer and gates project actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await enableControlledAndroidRuntime(page);

  const menu = page.locator("[data-runtime-simple-menu]");
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(menuBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  await menu.click();
  await expect(page.locator("html")).toHaveAttribute("data-runtime-menu-open", "true");

  const drawer = page.locator("[data-runtime-simple-drawer]");
  await expect(drawer).toBeVisible();
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(drawerBox?.width ?? 999).toBeLessThanOrEqual(304);

  await expect(drawer.getByRole("button", { name: "Home", exact: true })).toBeEnabled();
  await expect(drawer.getByRole("button", { name: "Editor", exact: true })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "Save project", exact: true })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "Export video", exact: true })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "Advanced controls", exact: true })).toBeEnabled();

  await menu.click();
  await expect(page.locator("html")).toHaveAttribute("data-runtime-menu-open", "false");

  await page.getByRole("button", { name: "Open local demo", exact: true }).click();
  await expect(page.getByText("local-demo-project", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-runtime-project-open", "true");

  await menu.click();
  await expect(drawer.getByRole("button", { name: "Editor", exact: true })).toBeEnabled();
  await expect(drawer.getByRole("button", { name: "Save project", exact: true })).toBeEnabled();
  await expect(drawer.getByRole("button", { name: "Export video", exact: true })).toBeEnabled();
});

test("Advanced controls always has a deterministic path back to Simple view", async ({ page }) => {
  await page.goto("/");
  await enableControlledAndroidRuntime(page);

  const menu = page.locator("[data-runtime-simple-menu]");
  await menu.click();
  const drawer = page.locator("[data-runtime-simple-drawer]");
  await drawer.getByRole("button", { name: "Advanced controls", exact: true }).click();

  await expect(page.locator("html")).toHaveClass(/runtime-advanced-ui/);
  await expect(menu).toHaveAttribute("aria-label", /simple/i);

  await menu.click();
  await expect(page.locator("html")).toHaveClass(/runtime-simple-ui/);
  await expect(page.locator("html")).not.toHaveClass(/runtime-advanced-ui/);
});
