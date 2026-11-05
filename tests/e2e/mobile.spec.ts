import { expect, test, type Page } from "@playwright/test";

/**
 * The phone layout (see the "mobile" project in playwright.config.ts): a
 * bottom bar instead of the status bar, sheets instead of bars and popups,
 * rating buttons instead of keys, and finger gestures.
 */

const state = (page: Page) => page.evaluate(() => window.photo!.state());
const activePhoto = async (page: Page) => {
  const s = await state(page);
  return s.photos.byId[s.selection.activeId!]!;
};
const cell = (page: Page, n: number) => page.getByRole("list", { name: "Photos" }).getByRole("button").nth(n);

/** A finger gesture through the browser's touch pipeline, so pointer events carry pointerType "touch". */
async function finger(page: Page, from: [number, number], to: [number, number], { hold = 0, steps = 6 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from[0], y: from[1] }] });
  if (hold) await page.waitForTimeout(hold);
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const y = from[1] + ((to[1] - from[1]) * i) / steps;
    if (x !== from[0] || y !== from[1]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Sample Library" }).tap();
  await expect(page.getByRole("list", { name: "Photos" })).toBeVisible();
});

test("the chrome: bottom bar with views, filter and photo menu; More in the top bar; no status bar", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Views and tools" });
  for (const name of ["Grid View", "Loupe View", "Develop View", "Filter and sort", "Photo menu"]) {
    await expect(nav.getByRole("button", { name })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "More" })).toBeVisible();
  await expect(page.getByRole("contentinfo")).toHaveCount(0);
  // The filter bar's controls live in the sheet, not above the grid.
  await expect(page.getByRole("toolbar", { name: "Filter and sort" })).toHaveCount(0);

  await page.getByRole("button", { name: "More" }).tap();
  const menu = page.getByRole("menu", { name: "More" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Keyboard Shortcuts" }).tap();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
});

test("the rating bar rates, flags and labels the active photo; tapping the current value clears it", async ({ page }) => {
  const bar = page.getByRole("toolbar", { name: "Rate and flag" });
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "3 stars", exact: true }).tap();
  expect((await activePhoto(page)).rating).toBe(3);
  await bar.getByRole("button", { name: "3 stars (tap to clear)" }).tap();
  expect((await activePhoto(page)).rating).toBe(0);

  await bar.getByRole("button", { name: "Pick", exact: true }).tap();
  expect((await activePhoto(page)).flag).toBe("pick");
  await bar.getByRole("button", { name: "Reject", exact: true }).tap();
  expect((await activePhoto(page)).flag).toBe("reject");
  await bar.getByRole("button", { name: "Rejected (tap to unflag)" }).tap();
  expect((await activePhoto(page)).flag).toBe("none");

  await bar.getByRole("button", { name: "green label", exact: true }).tap();
  expect((await activePhoto(page)).colorLabel).toBe("green");
  await bar.getByRole("button", { name: "green label (tap to remove)" }).tap();
  expect((await activePhoto(page)).colorLabel).toBe("none");

  // Auto-advance: on makes a rating move to the next photo; off restores the keyboard default.
  const before = (await state(page)).selection.activeId;
  await bar.getByRole("button", { name: /Auto-advance is off/ }).tap();
  expect((await state(page)).autoAdvance).toBe("always");
  await bar.getByRole("button", { name: "4 stars", exact: true }).tap();
  expect((await state(page)).selection.activeId).not.toBe(before);
  await bar.getByRole("button", { name: /Auto-advance is on/ }).tap();
  expect((await state(page)).autoAdvance).toBe("capsLock");
});

test("the filter sheet filters and sorts; the Filter tab shows when a filter is on", async ({ page }) => {
  await page.getByRole("button", { name: "Filter and sort", exact: true }).tap();
  const sheet = page.getByRole("dialog", { name: "Filter and sort" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Picked" }).tap();
  await expect(sheet.getByText(/of 48/)).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).tap();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Filter and sort (a filter is on)" })).toBeVisible();
  await expect(page.getByText("No photos match the filter.")).toBeVisible();

  await page.getByRole("button", { name: "Filter and sort (a filter is on)" }).tap();
  await sheet.getByRole("button", { name: "Clear" }).tap();
  await expect(sheet.getByText("48 photos")).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).tap();
  await expect(cell(page, 0)).toBeVisible();
});

test("the photo menu is a sheet: submenus drill in with a Back row", async ({ page }) => {
  await page.getByRole("button", { name: "Photo menu" }).tap();
  const menu = page.getByRole("menu", { name: "Photo" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Set Flag" }).tap();
  const sub = page.getByRole("menu", { name: "Set Flag" });
  await expect(sub).toBeVisible();
  await expect(menu).toBeHidden();
  await sub.getByRole("button", { name: "Back" }).tap();
  await expect(sub).toHaveCount(0);
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Set Rating" }).tap();
  await page.getByRole("menu", { name: "Set Rating" }).getByRole("menuitem", { name: "Rate ★★", exact: true }).tap();
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect((await activePhoto(page)).rating).toBe(2);
});

test("a long press on a photo opens its menu", async ({ page }) => {
  const box = (await cell(page, 1).boundingBox())!;
  const at: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
  await finger(page, at, at, { hold: 700 });
  await expect(page.getByRole("menu", { name: "Photo" })).toBeVisible();
  expect((await state(page)).selection.ids).toEqual(["DSC_0002.jpg"]);
  await page.getByRole("button", { name: "Close menu" }).tap();
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("tap selects a photo; a second tap opens it in Loupe; a swipe moves on", async ({ page }) => {
  await cell(page, 1).tap();
  expect((await state(page)).view).toBe("grid");
  expect((await state(page)).selection.activeId).toBe("DSC_0002.jpg");
  await cell(page, 1).tap();
  expect((await state(page)).view).toBe("loupe");
  await expect(page.getByRole("list", { name: "Filmstrip" })).toBeVisible();

  await finger(page, [300, 300], [120, 310]);
  expect((await state(page)).selection.activeId).toBe("DSC_0003.jpg");
  await finger(page, [100, 300], [300, 305]);
  expect((await state(page)).selection.activeId).toBe("DSC_0002.jpg");
  // A mostly vertical movement is not a swipe.
  await finger(page, [200, 200], [230, 400]);
  expect((await state(page)).selection.activeId).toBe("DSC_0002.jpg");
});

test("Develop stacks the controls under the photo in a sheet that collapses", async ({ page }) => {
  await page.getByRole("button", { name: "Develop View" }).tap();
  const panel = page.getByRole("complementary", { name: "Develop controls" });
  await expect(panel).toBeVisible();
  await expect(page.locator("[data-panel-state]")).toHaveAttribute("data-panel-state", "fixed");
  const canvas = page.getByRole("main").locator("canvas").first();
  await expect(canvas).toBeVisible();
  const stageBox = (await canvas.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.y).toBeGreaterThan(stageBox.y + stageBox.height - 1);
  expect(panelBox.width).toBeGreaterThan(380);

  await page.getByRole("button", { name: "Hide panel" }).tap();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Show Develop panel" }).tap();
  await expect(panel).toBeVisible();
});

test.describe("held sideways", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("keeps the bottom bar, and the Develop controls beside the photo", async ({ page }) => {
    await expect(page.getByRole("navigation", { name: "Views and tools" })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toHaveCount(0);
    await expect(page.getByRole("toolbar", { name: "Filter and sort" })).toHaveCount(0);
    await page.getByRole("button", { name: "Develop View" }).tap();
    const panel = page.getByRole("complementary", { name: "Develop controls" });
    await expect(panel).toBeVisible();
    await expect(page.locator("[data-panel-state]")).toHaveAttribute("data-panel-state", "fixed");
    const canvas = page.getByRole("main").locator("canvas").first();
    await expect(canvas).toBeVisible();
    const stageBox = (await canvas.boundingBox())!;
    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.x).toBeGreaterThan(stageBox.x + stageBox.width - 1);
    await expect(page.getByRole("button", { name: "Hide panel" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undock panel" })).toHaveCount(0);
  });
});
