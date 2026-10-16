import { expect, test, type Page } from "@playwright/test";

const grid = (page: Page) => page.getByRole("list", { name: "Photos" });
const cell = (page: Page, name: string) => grid(page).getByRole("button", { name, exact: true });
const status = (page: Page) => page.getByRole("contentinfo");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Sample Library" }).click();
  await expect(grid(page)).toBeVisible();
});

test("right-click a photo: it is selected and the menu acts on it", async ({ page }) => {
  await cell(page, "DSC_0004.jpg").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Photo" });
  await expect(menu).toBeVisible();
  await expect(status(page)).toContainText("DSC_0004.jpg");

  await menu.getByRole("menuitem", { name: "Set Rating" }).hover();
  const ratings = page.getByRole("menu", { name: "Set Rating" });
  const three = ratings.getByRole("menuitem", { name: "Rate ★★★", exact: true });
  await expect(three).toHaveAttribute("aria-keyshortcuts", "3"); // shows the current shortcut
  await expect(three.locator("kbd")).toHaveText("3");
  await ratings.getByRole("menuitem", { name: "Rate ★★", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(cell(page, "DSC_0004.jpg").getByLabel("2 stars")).toBeVisible();
});

test("right-click inside a multi-selection keeps it", async ({ page }) => {
  await cell(page, "DSC_0001.jpg").click();
  await cell(page, "DSC_0003.jpg").click({ modifiers: ["Shift"] });
  await cell(page, "DSC_0002.jpg").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Set Flag" }).click();
  await page.getByRole("menuitem", { name: "Flag as Pick" }).click();
  for (const n of ["DSC_0001.jpg", "DSC_0002.jpg", "DSC_0003.jpg"]) {
    await expect(cell(page, n).getByLabel("Picked")).toBeVisible();
  }
});

test("fully keyboard operable: Shift+F10, arrows, Enter, Escape", async ({ page }) => {
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Photo" });
  await expect(menu.getByRole("menuitem", { name: "Set Rating" })).toBeFocused();
  await page.keyboard.press("ArrowDown"); // Set Flag
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menuitem", { name: "Flag as Pick" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter"); // Flag as Rejected
  await expect(cell(page, "DSC_0001.jpg").getByLabel("Rejected")).toBeVisible();

  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("3"); // shortcuts work again once it's closed
  await expect(cell(page, "DSC_0001.jpg").getByLabel("3 stars")).toBeVisible();
});

/**
 * Playwright can't toggle the OS Caps Lock state, so these keys are dispatched as real
 * KeyboardEvents with modifierCapsLock set: the same path (getModifierState) a person's
 * Caps Lock takes through the keyboard host and keybinding service.
 */
async function pressWithCapsLock(page: Page, key: string, capsLock = true) {
  await page.evaluate(
    ([key, capsLock]) => {
      for (const type of ["keydown", "keyup"]) {
        window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true, modifierCapsLock: capsLock } as KeyboardEventInit));
      }
    },
    [key, capsLock] as const,
  );
}

test("auto-advance while Caps Lock is on", async ({ page }) => {
  await page.keyboard.press("2");
  await expect(status(page)).toContainText("DSC_0001.jpg");
  await expect(status(page)).not.toContainText("Auto-advance");

  await pressWithCapsLock(page, "3");
  await expect(status(page)).toContainText("Auto-advance");
  await expect(status(page)).toContainText("DSC_0002.jpg");
  await expect(cell(page, "DSC_0001.jpg").getByLabel("3 stars")).toBeVisible();
  await pressWithCapsLock(page, "P");
  await expect(status(page)).toContainText("DSC_0003.jpg");
  await expect(cell(page, "DSC_0002.jpg").getByLabel("Picked")).toBeVisible();

  await pressWithCapsLock(page, "4", false); // Caps Lock off again: no advance
  await expect(status(page)).not.toContainText("Auto-advance");
  await expect(status(page)).toContainText("DSC_0003.jpg");
});

test("auto-advance mode can be set from the palette", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("auto-advance");
  await page.keyboard.press("Enter");
  await page.getByRole("radio", { name: "Always" }).click();
  await expect(status(page)).toContainText("Auto-advance");
  await page.keyboard.press("1");
  await expect(status(page)).toContainText("DSC_0002.jpg");
});
