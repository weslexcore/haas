import { expect, test, type Locator, type Page } from "@playwright/test";
import { buildDng } from "./dng";

const FOLDER = "e2e-raw";
const grid = (page: Page) => page.getByRole("list", { name: "Photos" });
const cell = (page: Page, name: string) => grid(page).getByRole("button", { name, exact: true });
const status = (page: Page) => page.getByRole("contentinfo");
const canvas = (page: Page) => page.getByRole("main").locator("canvas").first();

/** Scene: red top half, blue bottom half (linear RGB). */
const scene = (_W: number, H: number) => (_x: number, y: number): [number, number, number] =>
  y < H / 2 ? [0.5, 0.08, 0.08] : [0.08, 0.08, 0.5];

/** A JPEG with an EXIF Orientation tag, like the previews Fujifilm embeds in RAF files. */
function withExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  // APP1 "Exif\0\0", then a little-endian TIFF header and IFD0 with one entry: Orientation (0x0112), SHORT.
  const tiff = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = app1.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...app1, ...jpeg.slice(2)]);
}

/** Mean RGB of a rectangle of a rendered canvas (fractions of its size). */
function meanRgb(c: Locator, x0: number, y0: number, x1: number, y1: number): Promise<number[]> {
  return c.evaluate(
    (el: HTMLCanvasElement, r) => {
      const ctx = new OffscreenCanvas(el.width, el.height).getContext("2d")!;
      ctx.drawImage(el, 0, 0);
      const x = Math.round(r[0]! * el.width), y = Math.round(r[1]! * el.height);
      const d = ctx.getImageData(x, y, Math.max(1, Math.round((r[2]! - r[0]!) * el.width)), Math.max(1, Math.round((r[3]! - r[1]!) * el.height))).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k]! += d[i + k]!;
      return sum.map((v) => v / (d.length / 4));
    },
    [x0, y0, x1, y1],
  );
}

async function seedRaw(page: Page) {
  // A green JPEG as RAW_0001's embedded preview, so the tests can tell it from a decode (red/blue).
  const preview = await page.evaluate(async () => {
    const c = new OffscreenCanvas(1800, 1200);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "rgb(40, 200, 60)";
    ctx.fillRect(0, 0, 1800, 1200);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg", quality: 0.8 })).arrayBuffer()));
  });
  const files: Record<string, Uint8Array | string> = {
    "RAW_0001.dng": buildDng({
      width: 600, height: 400, pixel: scene(600, 400), model: "TestRaw R1", iso: 1600, date: "2026:09:14 09:30:00",
      preview: { jpeg: Uint8Array.from(preview), width: 1800, height: 1200 },
    }),
    // No embedded preview, stored landscape, displayed portrait.
    "RAW_0002.dng": buildDng({ width: 600, height: 400, pixel: scene(600, 400), orientation: 6, date: "2026:09:14 09:31:00" }),
    // Displayed portrait, with an embedded preview that carries its own orientation too.
    "RAW_0004.dng": buildDng({
      width: 600, height: 400, pixel: scene(600, 400), orientation: 6, date: "2026:09:14 09:33:00",
      preview: { jpeg: withExifOrientation(Uint8Array.from(preview), 6), width: 1800, height: 1200 },
    }),
    // A RAW+JPEG pair: one photo.
    "PAIR_0003.dng": buildDng({ width: 600, height: 400, pixel: scene(600, 400), date: "2026:09:14 09:32:00" }),
    "PAIR_0003.JPG": "not decoded: travels with the RAW",
  };
  const encoded = Object.fromEntries(
    Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? btoa(v) : Buffer.from(v).toString("base64")]),
  );
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(folder);
  }, FOLDER);
  await page.evaluate(
    async ({ folder, files }) => {
      window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(folder);
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(folder, { recursive: true }).catch(() => undefined);
      const dir = await root.getDirectoryHandle(folder, { create: true });
      for (const [name, b64] of Object.entries(files)) {
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
        await w.close();
      }
    },
    { folder: FOLDER, files: encoded },
  );
}

async function exists(page: Page, path: string): Promise<boolean> {
  return page.evaluate(
    async ({ folder, path }) => {
      let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder);
      const parts = path.split("/");
      try {
        for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
        await d.getFileHandle(parts.at(-1)!);
        return true;
      } catch {
        return false;
      }
    },
    { folder: FOLDER, path },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await seedRaw(page);
  await page.getByRole("button", { name: "Open Folder…" }).first().click();
  await expect(grid(page).getByRole("listitem")).toHaveCount(4); // the pair's JPEG isn't listed
  await expect(status(page)).not.toContainText("Reading EXIF");
});

test("RAW files: thumbnails, EXIF and size from LibRaw, embedded preview in Loupe", async ({ page }) => {
  // Thumbnail from the embedded preview (green), and from a decode when there is none (portrait).
  const thumb1 = cell(page, "RAW_0001.dng").locator("img");
  await expect(thumb1).toBeVisible();
  const thumb2 = cell(page, "RAW_0002.dng").locator("img");
  await expect(thumb2).toBeVisible();
  const size2 = await thumb2.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]);
  expect(size2[1]).toBeGreaterThan(size2[0]!);
  // An embedded preview with its own EXIF orientation is rotated once, not twice.
  const thumb4 = cell(page, "RAW_0004.dng").locator("img");
  await expect(thumb4).toBeVisible();
  const size4 = await thumb4.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]);
  expect(size4[1]).toBeGreaterThan(size4[0]!);

  await cell(page, "RAW_0001.dng").dblclick();
  await page.keyboard.press("i");
  const info = page.getByLabel("Photo information");
  await expect(info).toContainText("TestRaw R1");
  await expect(info).toContainText("ISO 1600");
  await expect(info).toContainText("600 × 400");
  const img = page.getByRole("img", { name: "RAW_0001.dng" });
  await expect(img).toBeVisible();
  const loupe = await img.evaluate(async (el: HTMLImageElement) => {
    await el.decode();
    const c = new OffscreenCanvas(8, 8);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(el, 0, 0, 8, 8);
    return [el.naturalWidth, Array.from(ctx.getImageData(4, 4, 1, 1).data.slice(0, 3))] as const;
  });
  expect(loupe[0]).toBe(1800); // the embedded preview
  expect(loupe[1][1]).toBeGreaterThan(150); // green

  // A preview with its own EXIF orientation is rotated once, not twice.
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight"); // past RAW_0002 and the pair
  const portrait = page.getByRole("img", { name: "RAW_0004.dng" });
  await expect(portrait).toBeVisible();
  const loupe4 = await portrait.evaluate(async (el: HTMLImageElement) => (await el.decode(), [el.naturalWidth, el.naturalHeight]));
  expect(loupe4).toEqual([1200, 1800]);
});

test("RAW files: Develop demosaics the sensor data, upright, and exports", async ({ page }) => {
  await cell(page, "RAW_0002.dng").dblclick();
  await page.keyboard.press("d");
  await expect(canvas(page)).toBeVisible();
  // Orientation 6: the stored-left (top: red) half is now on the right.
  await expect.poll(() => canvas(page).evaluate((el: HTMLCanvasElement) => el.width / el.height)).toBeCloseTo(2 / 3, 1);
  await expect.poll(async () => (await meanRgb(canvas(page), 0.6, 0.1, 0.95, 0.9))[0]).toBeGreaterThan(150);
  const right = await meanRgb(canvas(page), 0.6, 0.1, 0.95, 0.9);
  const left = await meanRgb(canvas(page), 0.05, 0.1, 0.4, 0.9);
  expect(right[0]).toBeGreaterThan(right[2]! + 80); // red
  expect(left[2]).toBeGreaterThan(left[0]! + 80); // blue

  // Edits apply to RAW like any photo.
  const before = (await meanRgb(canvas(page), 0, 0, 1, 1)).reduce((a, b) => a + b);
  await page.evaluate(() => window.photo!.dispatch("develop.adjust", { setting: "exposure", value: -1 }));
  await expect.poll(async () => (await meanRgb(canvas(page), 0, 0, 1, 1)).reduce((a, b) => a + b)).toBeLessThan(before * 0.8);

  const r = await page.evaluate(() => window.photo!.dispatch("develop.export", { destination: "folder" }));
  expect(r).toMatchObject({ ok: true });
  await expect.poll(() => exists(page, "_Exports/RAW_0002.jpg")).toBe(true);
});

test("RAW+JPEG pairs are one photo: the JPEG moves with the RAW", async ({ page }) => {
  await cell(page, "PAIR_0003.dng").click();
  await page.keyboard.press("e");
  await page.keyboard.press("i");
  await expect(page.getByLabel("Photo information")).toContainText("+JPG");
  await page.keyboard.press("x");
  await page.evaluate(() => window.photo!.dispatch("library.rejected.remove"));
  await expect.poll(() => exists(page, "_Rejected/PAIR_0003.JPG")).toBe(true);
  expect(await exists(page, "_Rejected/PAIR_0003.dng")).toBe(true);
  expect(await exists(page, "PAIR_0003.JPG")).toBe(false);

  await page.keyboard.press("ControlOrMeta+z"); // undo: both come back
  await expect.poll(() => exists(page, "PAIR_0003.JPG")).toBe(true);
  expect(await exists(page, "PAIR_0003.dng")).toBe(true);
  await expect(status(page)).toContainText("4 photos");
});
