import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Sample Library" }).click();
  await expect(page.getByRole("list", { name: "Photos" })).toBeVisible();
});

const palette = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "Command palette" });

test("opens with mod+k, searches, and runs an action", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.type("loupe");
  const first = palette(page).getByRole("option").first();
  await expect(first).toContainText("Loupe View");
  await expect(first.locator("kbd")).toHaveText("E");
  await page.keyboard.press("Enter");
  await expect(palette(page)).toBeHidden();
  await expect(page.getByRole("main")).toHaveAttribute("aria-label", "loupe view");
});

test("multi-word fuzzy search", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("dev view");
  await expect(palette(page).getByRole("option").first()).toContainText("Develop View");
});

test("parameter step generated from the schema", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("set rating");
  await page.keyboard.press("Enter");
  await expect(palette(page).getByRole("radiogroup")).toBeVisible();
  await page.keyboard.press("4"); // typing an option's label picks it and runs
  await expect(palette(page)).toBeHidden();
  await expect(page.getByRole("contentinfo")).toContainText("Last change: Rate ★★★★");
});

test("shows the user's current shortcut, not just the default", async ({ page }) => {
  await page.evaluate(() =>
    localStorage.setItem("photo:keybindings.overrides", JSON.stringify({ "app.theme.toggle": [{ keys: "shift+t" }] })),
  );
  await page.reload();
  await expect(page.getByRole("list", { name: "Photos" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("toggle light");
  await expect(palette(page).getByRole("option").first().locator("kbd")).toHaveText(["⇧T"]);
});

test("recently used actions come first", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("select all");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+k");
  const first = palette(page).getByRole("option").first();
  await expect(first).toContainText("Select All");
  await expect(first).toContainText("recent");
});

test("? switches to AI mode (stubbed until Phase 4)", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("?show me only 4+ star photos");
  const options = palette(page).getByRole("option");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("Ask AI");
  await page.keyboard.press("Enter");
  await expect(palette(page).getByRole("alert")).toContainText("Phase 4");
});

test("a binding without params opens the palette on the param step", async ({ page }) => {
  await page.evaluate(() => window.photo!.dispatch("app.shortcuts.bind", { actionId: "library.rating.set", keys: "r" }));
  await page.keyboard.press("r");
  await expect(palette(page).getByText("Set Rating", { exact: true })).toBeVisible();
  await expect(palette(page).getByRole("radiogroup")).toBeVisible();
});

test("palette is exposed to assistive tech as a combobox + listbox", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+k");
  const box = page.getByRole("combobox", { name: "Search actions" });
  await expect(box).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(box).toHaveAttribute("aria-activedescendant", "palette-option-1");
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();
});
