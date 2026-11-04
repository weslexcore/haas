import { expect, test, type Locator, type Page } from "@playwright/test";

const panel = (page: Page) => page.getByRole("complementary", { name: "Develop controls" });
const filmstrip = (page: Page) => page.getByRole("list", { name: "Filmstrip" });
const canvas = (page: Page) => page.getByRole("main").locator("canvas").first();
const panelHeader = (page: Page) => page.locator("[data-panel-state]").getByText("Develop", { exact: true });

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("not visible");
  return b;
}

/** Press on the middle of `from` and drag by (dx, dy). */
async function drag(page: Page, from: Locator, dx: number, dy: number) {
  const b = await box(from);
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

test.describe("layout: resizable and dockable panels (sample library)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open Sample Library" }).click();
    await page.keyboard.press("d");
    await expect(panel(page)).toBeVisible();
    await expect(canvas(page)).toBeVisible();
  });

  test("filmstrip resizes by dragging its top edge, persists, and resets on double-click", async ({ page }) => {
    const handle = page.getByRole("separator", { name: "Filmstrip height" });
    expect((await box(filmstrip(page))).height).toBeCloseTo(96, 0);

    await drag(page, handle, 0, -60);
    expect((await box(filmstrip(page))).height).toBeCloseTo(156, 0);
    await expect(handle).toHaveAttribute("aria-valuenow", "156");

    await page.reload();
    await page.keyboard.press("d");
    await expect(filmstrip(page)).toBeVisible();
    expect((await box(filmstrip(page))).height).toBeCloseTo(156, 0);

    // Loupe shares the strip and its height.
    await page.keyboard.press("e");
    await expect(page.getByRole("main", { name: "loupe view" })).toBeVisible();
    expect((await box(filmstrip(page))).height).toBeCloseTo(156, 0);

    await page.getByRole("separator", { name: "Filmstrip height" }).dblclick();
    expect((await box(filmstrip(page))).height).toBeCloseTo(96, 0);
  });

  test("develop panel resizes by drag and keyboard", async ({ page }) => {
    const handle = page.getByRole("separator", { name: "Develop panel width" });
    expect((await box(panel(page))).width).toBeCloseTo(300, 0);

    await drag(page, handle, -80, 0); // panel is on the right: dragging left widens it
    expect((await box(panel(page))).width).toBeCloseTo(380, 0);

    await handle.focus();
    await page.keyboard.press("ArrowLeft");
    expect((await box(panel(page))).width).toBeCloseTo(396, 0);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect((await box(panel(page))).width).toBeCloseTo(364, 0);
    // Arrow keys on the handle resized rather than navigating photos.
    await expect(page.getByRole("contentinfo")).toContainText("DSC_0001.jpg");

    await handle.press("End");
    expect((await box(panel(page))).width).toBeCloseTo(640, 0);
    await handle.dblclick();
    expect((await box(panel(page))).width).toBeCloseTo(300, 0);
  });

  test("panel undocks, floats where it is dragged, and docks on the side it is dropped against", async ({ page }) => {
    await page.getByRole("button", { name: "Undock panel" }).click();
    const floating = page.getByRole("dialog", { name: "Develop panel (floating)" });
    await expect(floating).toBeVisible();
    // The stage now spans the whole width, so the photo is centred in the window.
    const stage = await box(canvas(page));
    expect(stage.x + stage.width / 2).toBeGreaterThan(600);

    // Move it by its header.
    const header = panelHeader(page);
    const before = await box(floating);
    await drag(page, header, 150, 100);
    const after = await box(floating);
    expect(after.x).toBeCloseTo(before.x + 150, 0);
    expect(after.y).toBeCloseTo(before.y + 100, 0);

    // Resize from the corner.
    await page.mouse.move(after.x + after.width - 6, after.y + after.height - 6);
    await page.mouse.down();
    await page.mouse.move(after.x + after.width + 60, after.y + after.height - 50, { steps: 4 });
    await page.mouse.up();
    const resized = await box(floating);
    expect(resized.width).toBeCloseTo(after.width + 66, 0);
    expect(resized.height).toBeCloseTo(after.height - 44, 0);

    // Drop it against the left edge: it docks there, left of the photo.
    const h = await box(header);
    await page.mouse.move(h.x + 10, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(200, 300, { steps: 4 });
    await page.mouse.move(8, 300, { steps: 4 });
    await expect(page.locator("[class*='dockZone']")).toBeVisible();
    await page.mouse.up();
    await expect(floating).toHaveCount(0);
    expect((await box(panel(page))).x).toBeLessThan((await box(canvas(page))).x);

    // Header button swaps sides; the choice survives a reload.
    await page.getByRole("button", { name: "Move panel to the right" }).click();
    expect((await box(panel(page))).x).toBeGreaterThan((await box(canvas(page))).x);
    await page.reload();
    await page.keyboard.press("d");
    await expect(panel(page)).toBeVisible();
    expect((await box(panel(page))).x).toBeGreaterThan((await box(canvas(page))).x);
    await expect(page.getByRole("button", { name: "Move panel to the left" })).toBeVisible();
  });

  test("dragging a docked panel's header tears it off", async ({ page }) => {
    await drag(page, panelHeader(page), -300, 120);
    const floating = page.getByRole("dialog", { name: "Develop panel (floating)" });
    await expect(floating).toBeVisible();
    const f = await box(floating);
    expect(f.x).toBeLessThan(1280 - 300);
    expect(f.width).toBeCloseTo(340, 0);

    // Docking from the floating header's buttons.
    await page.getByRole("button", { name: "Dock panel on the left" }).click();
    await expect(floating).toHaveCount(0);
    expect((await box(panel(page))).x).toBeLessThan((await box(canvas(page))).x);
  });

  test("layout actions are scriptable and remembered", async ({ page }) => {
    await page.evaluate(async () => {
      await window.photo!.dispatch("view.panel.side.set", { side: "left" });
      await window.photo!.dispatch("view.panel.resize", { width: 420 });
    });
    expect((await box(panel(page))).x).toBeLessThan((await box(canvas(page))).x);
    expect((await box(panel(page))).width).toBeCloseTo(420, 0);
    await page.reload();
    await page.keyboard.press("d");
    await expect(panel(page)).toBeVisible();
    expect((await box(panel(page))).width).toBeCloseTo(420, 0);
    expect(await page.evaluate(() => window.photo!.state().layout.panelSide)).toBe("left");
  });
});
