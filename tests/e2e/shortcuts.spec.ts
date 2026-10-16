import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Sample Library" }).click();
  await expect(page.getByRole("list", { name: "Photos" })).toBeVisible();
});

const view = (page: Page) => page.getByRole("main");
const settings = (page: Page) => page.getByRole("dialog", { name: "Keyboard shortcuts" });

test("culling from the keyboard, with undo", async ({ page }) => {
  const status = page.getByRole("contentinfo");
  await page.keyboard.press("3");
  await expect(status).toContainText("DSC_0001.jpg");
  await expect(status.getByLabel("3 stars")).toBeVisible();
  await page.keyboard.press("p");
  await expect(status.getByLabel("Picked")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(status).toContainText("DSC_0002.jpg");
  await page.keyboard.press("x");
  await expect(status.getByLabel("Rejected")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+z");
  await expect(status.getByLabel("Rejected")).toBeHidden();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(status.getByLabel("Rejected")).toBeVisible();
});

test("view shortcuts and context-aware before/after", async ({ page }) => {
  await page.keyboard.press("\\"); // unavailable outside Develop: no effect
  await page.keyboard.press("d");
  await expect(view(page)).toHaveAttribute("aria-label", "develop view");
  await page.keyboard.press("\\");
  await expect(page.getByText("Before", { exact: true })).toBeVisible();
  await page.keyboard.press("g");
  await expect(view(page)).toHaveAttribute("aria-label", "grid view");
});

test("chord shortcut toggles theme", async ({ page }) => {
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.keyboard.press("t");
  await page.keyboard.press("t");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(before);
});

test("rebind a shortcut by pressing keys, and it persists", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+/");
  await expect(settings(page)).toBeVisible();
  await page.getByRole("searchbox", { name: "Search actions or keys" }).fill("switch view");
  await page.getByRole("button", { name: /Change shortcut G for Grid View/ }).click();
  await expect(settings(page).getByText("Press keys…")).toBeVisible();
  await page.keyboard.press("h");
  await expect(page.getByRole("button", { name: /Change shortcut H for Grid View/ })).toBeVisible();
  await expect(settings(page).getByText("modified")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings(page)).toBeHidden();

  await page.keyboard.press("e");
  await page.keyboard.press("g"); // old key no longer bound
  await expect(view(page)).toHaveAttribute("aria-label", "loupe view");
  await page.keyboard.press("h");
  await expect(view(page)).toHaveAttribute("aria-label", "grid view");

  await page.reload();
  await expect(page.getByRole("list", { name: "Photos" })).toBeVisible();
  await page.keyboard.press("e");
  await page.keyboard.press("h");
  await expect(view(page)).toHaveAttribute("aria-label", "grid view");
});

test("conflicts are shown and can be resolved", async ({ page }) => {
  await page.evaluate(() => window.photo!.dispatch("app.shortcuts.bind", { actionId: "navigation.next", keys: "p" }));
  await page.keyboard.press("ControlOrMeta+/");
  const conflicts = settings(page).getByRole("region", { name: "Conflicts" });
  await expect(conflicts).toContainText("is assigned to");
  await expect(conflicts).toContainText("“Flag as Pick”");
  await expect(conflicts).toContainText("“Next Photo”");
  await conflicts.getByRole("button", { name: "Keep for “Flag as Pick”" }).click();
  await expect(conflicts).toBeHidden();
});

test("reset an action to its default", async ({ page }) => {
  await page.evaluate(() => window.photo!.dispatch("app.shortcuts.bind", { actionId: "history.redo", keys: "mod+y", replaceIndex: 0 }));
  await page.keyboard.press("ControlOrMeta+/");
  await page.getByRole("searchbox", { name: "Search actions or keys" }).fill("redo");
  await settings(page).getByRole("button", { name: "Reset", exact: true }).click();
  await expect(settings(page).getByText("modified")).toBeHidden();
});

test("export and import bindings as JSON", async ({ page }) => {
  await page.evaluate(() => window.photo!.dispatch("app.shortcuts.bind", { actionId: "history.redo", keys: "mod+y", replaceIndex: 0 }));
  await page.keyboard.press("ControlOrMeta+/");
  const download = page.waitForEvent("download");
  await settings(page).getByRole("button", { name: "Export", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("photo-shortcuts.json");
  const path = await file.path();

  await settings(page).getByRole("button", { name: "Reset all" }).click({ trial: true });
  page.once("dialog", (d) => void d.accept());
  await settings(page).getByRole("button", { name: "Reset all" }).click();
  await expect(settings(page).getByText("modified")).toHaveCount(0);

  await settings(page).locator('input[type="file"]').setInputFiles(path);
  await expect(page.getByText("Imported overrides for 1 action(s)")).toBeVisible();
  await expect(settings(page).getByText("modified")).toHaveCount(1);
});
