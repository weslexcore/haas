import { expect, test, type Locator, type Page } from "@playwright/test";
import { FOLDER, readShootFile, seedShoot } from "./fixtures";

const status = (page: Page) => page.getByRole("contentinfo");
const canvas = (page: Page) => page.getByRole("main").locator("canvas").first();

/** Mean brightness (0–255) of a rendered WebGL canvas. */
async function brightness(c: Locator): Promise<number> {
  return c.evaluate((el: HTMLCanvasElement) => {
    const ctx = new OffscreenCanvas(el.width, el.height).getContext("2d")!;
    ctx.drawImage(el, 0, 0);
    const d = ctx.getImageData(0, 0, el.width, el.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i]! * 0.2126 + d[i + 1]! * 0.7152 + d[i + 2]! * 0.0722;
    return sum / (d.length / 4);
  });
}

async function settled(c: Locator): Promise<number> {
  // Rendering happens on the next animation frame; wait until two reads agree.
  let last = -1;
  for (let i = 0; i < 20; i++) {
    const v = await brightness(c);
    if (Math.abs(v - last) < 0.01) return v;
    last = v;
    await c.page().waitForTimeout(50);
  }
  return last;
}

test.describe("develop (sample library)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open Sample Library" }).click();
    await page.keyboard.press("d");
    await expect(page.getByRole("complementary", { name: "Develop controls" })).toBeVisible();
    await expect(canvas(page)).toBeVisible();
  });

  test("sliders edit live, one undo step per drag, before/after shows the original", async ({ page }) => {
    const before = await settled(canvas(page));
    const exposure = page.getByRole("slider", { name: "Exposure" });
    await exposure.focus();
    for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowRight"); // +0.40, as one gesture
    await expect(page.getByRole("complementary", { name: "Develop controls" })).toContainText("+0.40");
    const after = await settled(canvas(page));
    expect(after).toBeGreaterThan(before + 5);
    await expect(status(page)).toContainText("Last change: Exposure +0.40");

    // Arrow keys on the slider adjusted it rather than navigating photos.
    await expect(status(page)).toContainText("DSC_0001.jpg");

    await exposure.blur();
    await page.keyboard.press("\\");
    await expect(page.getByText("Before", { exact: true })).toBeVisible();
    expect(Math.abs((await settled(canvas(page))) - before)).toBeLessThan(1);
    await page.keyboard.press("\\");

    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByRole("complementary", { name: "Develop controls" })).not.toContainText("+0.40");
    expect(Math.abs((await settled(canvas(page))) - before)).toBeLessThan(1);
  });

  test("histogram follows the edit", async ({ page }) => {
    const histogram = page.getByRole("img", { name: "Histogram" });
    const pixels = () => histogram.evaluate((el: HTMLCanvasElement) => el.getContext("2d")!.getImageData(0, 0, el.width, el.height).data.reduce((a, b) => a + b, 0));
    await expect.poll(pixels).toBeGreaterThan(0);
    const before = await pixels();
    await page.evaluate(() => window.photo!.dispatch("develop.adjust", { setting: "exposure", value: -3 }));
    await expect.poll(pixels).not.toBe(before);
  });

  test("copy and paste settings; edited thumbnails show the edit", async ({ page }) => {
    await page.evaluate(() => window.photo!.dispatch("develop.settings.apply", { settings: { saturation: -100 } }));
    await page.keyboard.press("ControlOrMeta+Shift+c");
    await page.keyboard.press("ArrowRight");
    await expect(status(page)).toContainText("DSC_0002.jpg");
    await page.keyboard.press("ControlOrMeta+Shift+v");
    const settings = await page.evaluate(() => window.photo!.dispatch("develop.settings.get"));
    expect(settings).toMatchObject({ ok: true, value: { edited: true, settings: { saturation: -100 } } });
    // The filmstrip thumbnail is re-rendered with the edit (greyscale).
    const thumb = page.getByRole("list", { name: "Filmstrip" }).getByRole("button", { name: "DSC_0002.jpg" }).locator("img");
    await expect(thumb).toBeVisible();
    const grey = await thumb.evaluate(async (el: HTMLImageElement) => {
      await el.decode();
      const c = new OffscreenCanvas(el.naturalWidth, el.naturalHeight).getContext("2d")!;
      c.drawImage(el, 0, 0);
      const d = c.getImageData(0, 0, el.naturalWidth, el.naturalHeight).data;
      let maxSpread = 0;
      for (let i = 0; i < d.length; i += 4) maxSpread = Math.max(maxSpread, Math.max(d[i]!, d[i + 1]!, d[i + 2]!) - Math.min(d[i]!, d[i + 1]!, d[i + 2]!));
      return maxSpread;
    });
    expect(grey).toBeLessThan(12); // JPEG noise only
  });

  test("crop tool: drag a handle, the result is cropped", async ({ page }) => {
    const ratio = () => canvas(page).evaluate((el: HTMLCanvasElement) => el.width / el.height);
    await expect.poll(ratio).toBeCloseTo(1.5, 1);
    await page.keyboard.press("r");
    const area = page.getByRole("group", { name: "Crop area" });
    await expect(area).toBeVisible();
    const box = (await area.boundingBox())!;
    // Drag the right edge halfway in.
    await page.mouse.move(box.x + box.width, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.press("r");
    await expect(area).toBeHidden();
    await expect.poll(ratio).toBeCloseTo(0.75, 1);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(ratio).toBeCloseTo(1.5, 1); // the whole drag was one step
  });

  test("Loupe shows edits too", async ({ page }) => {
    await page.evaluate(() => window.photo!.dispatch("develop.crop.set", { aspect: "1:1" }));
    await page.keyboard.press("e");
    const c = page.getByRole("main").getByRole("img", { name: "DSC_0001.jpg" });
    await expect(c).toBeVisible();
    await expect.poll(() => c.evaluate((el) => (el instanceof HTMLCanvasElement ? el.width / el.height : 0))).toBeCloseTo(1, 2);
  });
});

test.describe("develop with real files", () => {
  async function openShoot(page: Page) {
    await page.goto("/");
    await seedShoot(page);
    await page.getByRole("button", { name: "Open Folder…" }).first().click();
    await expect(page.getByRole("list", { name: "Photos" }).getByRole("listitem")).toHaveCount(4);
  }

  /** Decode an exported file from the seeded folder and measure it. */
  function measureExport(page: Page, path: string) {
    return page.evaluate(
      async ({ folder, path }) => {
        let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder);
        const parts = path.split("/");
        for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
        const file = await (await dir.getFileHandle(parts.at(-1)!)).getFile();
        const bmp = await createImageBitmap(file);
        const c = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
        c.drawImage(bmp, 0, 0);
        const d = c.getImageData(0, 0, bmp.width, bmp.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i]! * 0.2126 + d[i + 1]! * 0.7152 + d[i + 2]! * 0.0722;
        return { type: file.type, width: bmp.width, height: bmp.height, brightness: sum / (d.length / 4) };
      },
      { folder: FOLDER, path },
    );
  }

  test("export renders full resolution with edits into _Exports, never overwriting", async ({ page }) => {
    await openShoot(page);
    await page.getByRole("list", { name: "Photos" }).getByRole("button", { name: "IMG_0001.jpg", exact: true }).click();
    await page.keyboard.press("ControlOrMeta+Shift+e");
    await expect(page.getByText("Exported 1 photo to the _Exports folder.")).toBeVisible();
    const plain = await measureExport(page, "_Exports/IMG_0001.jpg");
    expect(plain).toMatchObject({ width: 1200, height: 800 });

    await page.evaluate(() => window.photo!.dispatch("develop.settings.apply", { settings: { exposure: 1, crop: { x: 0, y: 0, width: 0.5, height: 1 } } }));
    await page.evaluate(() => window.photo!.dispatch("develop.export"));
    const edited = await measureExport(page, "_Exports/IMG_0001-2.jpg");
    expect(edited).toMatchObject({ width: 600, height: 800 });
    expect(edited.brightness).toBeGreaterThan(plain.brightness + 10);
    expect(await readShootFile(page, "IMG_0001.jpg")).not.toBeNull(); // original untouched

    // Exports never show up as photos in the library.
    await page.reload();
    await expect(page.getByRole("list", { name: "Photos" }).getByRole("listitem")).toHaveCount(4);
  });

  test("portrait photos export upright", async ({ page }) => {
    await openShoot(page);
    await page.getByRole("list", { name: "Photos" }).getByRole("button", { name: "IMG_0004.jpg", exact: true }).click();
    await page.evaluate(() => window.photo!.dispatch("develop.export"));
    await expect(page.getByText("Exported 1 photo")).toBeVisible();
    expect(await measureExport(page, "_Exports/IMG_0004.jpg")).toMatchObject({ width: 800, height: 1200 });
  });

  test("edits are saved in the sidecar and restored after reload", async ({ page }) => {
    await openShoot(page);
    await page.getByRole("list", { name: "Photos" }).getByRole("button", { name: "IMG_0002.jpg", exact: true }).click();
    await page.evaluate(() => window.photo!.dispatch("develop.adjust", { setting: "temperature", value: 33 }));
    await page.evaluate(() => window.photo!.flushMetadata());
    const sidecar = await readShootFile(page, "IMG_0002.xmp");
    expect(sidecar).toContain("photo:Edit=");
    expect(sidecar).toContain("&quot;temperature&quot;:33");
    expect(sidecar).toContain('xmp:Label="Green"'); // other data intact

    await page.reload();
    await expect(page.getByRole("list", { name: "Photos" }).getByRole("listitem")).toHaveCount(4);
    const r = await page.evaluate(() => window.photo!.dispatch("develop.settings.get", { photoId: "IMG_0002.jpg" }));
    expect(r).toMatchObject({ ok: true, value: { settings: { temperature: 33 } } });
  });
});
