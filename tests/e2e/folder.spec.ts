import { expect, test, type Page } from "@playwright/test";
import { readShootFile, seedShoot } from "./fixtures";

const grid = (page: Page) => page.getByRole("list", { name: "Photos" });
const cell = (page: Page, name: string) => grid(page).getByRole("button", { name, exact: true });
const status = (page: Page) => page.getByRole("contentinfo");

async function openShoot(page: Page) {
  await page.goto("/");
  await seedShoot(page);
  await page.getByRole("button", { name: "Open Folder…" }).first().click();
  await expect(grid(page).getByRole("listitem")).toHaveCount(4);
  await expect(status(page)).not.toContainText("Reading EXIF");
}

test("opens a folder: thumbnails from a worker, EXIF, existing sidecars", async ({ page }) => {
  await openShoot(page);
  await expect(status(page)).toContainText("e2e-shoot");
  // The header button now names the open folder.
  await expect(page.getByRole("banner").getByRole("button", { name: "Open Folder…" })).toHaveText("e2e-shoot");
  await expect(status(page)).toContainText("4 photos");

  // Thumbnails are real decoded images.
  const img = cell(page, "IMG_0001.jpg").locator("img");
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(100);

  // Ratings and labels written by another app are picked up from the sidecar.
  await expect(cell(page, "IMG_0002.jpg").getByLabel("4 stars")).toBeVisible();
  await expect(cell(page, "IMG_0002.jpg").getByLabel("green label")).toBeVisible();

  // EXIF in the loupe info overlay.
  await cell(page, "IMG_0003.jpg").dblclick();
  await page.keyboard.press("i");
  const info = page.getByLabel("Photo information");
  await expect(info).toContainText("TestCo TestCam X1");
  await expect(info).toContainText("ISO 3200");
  await expect(info).toContainText("1200 × 800");
  await expect(page.getByRole("img", { name: "IMG_0003.jpg" })).toBeVisible();
});

test("portrait photos are rotated and always fit in the viewport", async ({ page }) => {
  await openShoot(page);
  // Stored 1200×800 with EXIF orientation 6: indexed, thumbnailed and shown as portrait.
  const thumb = cell(page, "IMG_0004.jpg").locator("img");
  await expect(thumb).toBeVisible();
  const t = await thumb.evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight }));
  expect(t.h).toBeGreaterThan(t.w);
  // Letterboxed in its cell, not cropped: the element is no larger than its frame.
  const fit = await thumb.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const f = el.parentElement!.getBoundingClientRect();
    return r.height <= f.height + 0.5 && r.width <= f.width + 0.5 && getComputedStyle(el).objectFit === "contain";
  });
  expect(fit).toBe(true);

  await cell(page, "IMG_0004.jpg").dblclick();
  const img = page.getByRole("img", { name: "IMG_0004.jpg" });
  await expect(img).toBeVisible();
  await page.keyboard.press("i");
  await expect(page.getByLabel("Photo information")).toContainText("800 × 1200");

  for (const size of [{ width: 1280, height: 600 }, { width: 700, height: 900 }]) {
    await page.setViewportSize(size);
    // The rendered photo (object-fit: contain) must lie inside the stage and the window.
    const box = await img.evaluate((el: HTMLImageElement) => {
      const r = el.getBoundingClientRect();
      const scale = Math.min(r.width / el.naturalWidth, r.height / el.naturalHeight);
      const w = el.naturalWidth * scale;
      const h = el.naturalHeight * scale;
      return { top: r.top + (r.height - h) / 2, bottom: r.top + (r.height + h) / 2, left: r.left + (r.width - w) / 2, right: r.left + (r.width + w) / 2 };
    });
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(size.height);
    expect(box.right).toBeLessThanOrEqual(size.width);
  }
});

test("ratings are written to XMP sidecars, keeping other apps' data", async ({ page }) => {
  await openShoot(page);
  await cell(page, "IMG_0002.jpg").click();
  await page.keyboard.press("5");
  await cell(page, "IMG_0003.jpg").click();
  await page.keyboard.press("x");
  await page.evaluate(() => window.photo!.flushMetadata());

  const updated = await readShootFile(page, "IMG_0002.xmp");
  expect(updated).toContain('xmp:Rating="5"');
  expect(updated).toContain('xmp:Label="Green"'); // untouched
  const created = await readShootFile(page, "day2/IMG_0003.xmp");
  expect(created).toContain('xmp:Rating="-1"'); // rejected, Bridge/darktable convention
  expect(await readShootFile(page, "IMG_0001.xmp")).toBeNull(); // never touched
});

test("the folder and its ratings come back after a reload", async ({ page }) => {
  await openShoot(page);
  await cell(page, "IMG_0001.jpg").click();
  await page.keyboard.press("3");
  await page.keyboard.press("6");
  await page.evaluate(() => window.photo!.flushMetadata());

  await page.reload();
  await expect(grid(page).getByRole("listitem")).toHaveCount(4);
  await expect(cell(page, "IMG_0001.jpg").getByLabel("3 stars")).toBeVisible();
  await expect(cell(page, "IMG_0001.jpg").getByLabel("red label")).toBeVisible();
});

test("filter bar", async ({ page }) => {
  await openShoot(page);
  await page.getByRole("button", { name: "4 stars and up" }).click();
  await expect(grid(page).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("toolbar", { name: "Filter and sort" })).toContainText("1 of 4");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(grid(page).getByRole("listitem")).toHaveCount(4);
  await page.getByRole("searchbox", { name: "Filter by file name" }).fill("day2");
  await expect(grid(page).getByRole("listitem")).toHaveCount(1);
});

test("remove rejected photos to _Rejected, restore them, then delete for good", async ({ page }) => {
  await openShoot(page);
  await cell(page, "IMG_0002.jpg").click();
  await page.keyboard.press("x");
  await page.evaluate(() => window.photo!.flushMetadata());

  await page.keyboard.press("ControlOrMeta+Backspace");
  await expect(grid(page).getByRole("listitem")).toHaveCount(3);
  await expect(page.getByText("Moved 1 photo to the _Rejected folder")).toBeVisible();
  const removed = page.getByRole("group", { name: "Removed photos" });
  await expect(removed).toContainText("1 photo in _Rejected");
  // Moved on disk, sidecar included; nothing deleted.
  expect(await readShootFile(page, "IMG_0002.jpg")).toBeNull();
  expect(await readShootFile(page, "_Rejected/IMG_0002.jpg")).not.toBeNull();
  expect(await readShootFile(page, "_Rejected/IMG_0002.xmp")).toContain('xmp:Rating="-1"');

  // ⌘Z puts the file back; ⌘⇧Z removes it again.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(grid(page).getByRole("listitem")).toHaveCount(4);
  expect(await readShootFile(page, "IMG_0002.jpg")).not.toBeNull();
  await expect(removed).toBeHidden();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(grid(page).getByRole("listitem")).toHaveCount(3);
  expect(await readShootFile(page, "_Rejected/IMG_0002.jpg")).not.toBeNull();

  // Survives a reload: still out of the library, still restorable.
  await page.reload();
  await expect(grid(page).getByRole("listitem")).toHaveCount(3);
  await removed.getByRole("button", { name: "Restore removed photos" }).click();
  await expect(grid(page).getByRole("listitem")).toHaveCount(4);
  expect(await readShootFile(page, "IMG_0002.xmp")).toContain('xmp:Label="Green"');

  // Remove again, then delete permanently (after a confirmation).
  await cell(page, "IMG_0002.jpg").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove Rejected Photos" }).click();
  await expect(removed).toBeVisible();
  page.once("dialog", (d) => {
    expect(d.message()).toContain("Permanently delete 1 photo");
    void d.accept();
  });
  await removed.getByRole("button", { name: "Delete…" }).click();
  await expect(removed).toBeHidden();
  expect(await readShootFile(page, "_Rejected/IMG_0002.jpg")).toBeNull();
  expect(await readShootFile(page, "IMG_0001.jpg")).not.toBeNull();
});
