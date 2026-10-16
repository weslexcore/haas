import { expect, test, type Page } from "@playwright/test";
import { seedShoot } from "./fixtures";

const status = (page: Page) => page.getByRole("contentinfo");
const main = (page: Page) => page.getByRole("main");

test("view and photo are kept in the URL and restored on reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Sample Library" }).click();
  await expect(page.getByRole("list", { name: "Photos" })).toBeVisible();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("e");
  await expect(main(page)).toHaveAttribute("aria-label", "loupe view");
  await expect(page).toHaveURL(/folder=sample/);
  await expect(page).toHaveURL(/view=loupe/);
  await expect(page).toHaveURL(/photo=DSC_0005\.jpg/);

  await page.reload();
  await expect(main(page)).toHaveAttribute("aria-label", "loupe view");
  await expect(status(page)).toContainText("DSC_0005.jpg");
});

test("browser Back returns to the previous view; photo changes don't add history", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Sample Library" }).click();
  await expect(page.getByRole("list", { name: "Photos" })).toBeVisible();
  await page.keyboard.press("d");
  await expect(main(page)).toHaveAttribute("aria-label", "develop view");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect(status(page)).toContainText("DSC_0004.jpg");
  await page.goBack();
  await expect(main(page)).toHaveAttribute("aria-label", "grid view");
  await page.goForward();
  await expect(main(page)).toHaveAttribute("aria-label", "develop view");
  await expect(status(page)).toContainText("DSC_0004.jpg");
});

test("works with real folders and paths with subfolders", async ({ page }) => {
  await page.goto("/");
  await seedShoot(page);
  await page.getByRole("button", { name: "Open Folder…" }).first().click();
  await page.getByRole("list", { name: "Photos" }).getByRole("button", { name: "IMG_0003.jpg", exact: true }).dblclick();
  await expect(page).toHaveURL(/photo=day2%2FIMG_0003\.jpg/);
  await page.reload();
  await expect(main(page)).toHaveAttribute("aria-label", "loupe view");
  await expect(status(page)).toContainText("IMG_0003.jpg");
});

test("a link for a folder that isn't open is ignored", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Sample Library" }).click();
  await expect(page.getByRole("list", { name: "Photos" })).toBeVisible();
  await page.goto("/?folder=someone-elses&view=develop&photo=nope.jpg");
  await expect(page.getByRole("list", { name: "Photos" })).toBeVisible();
  await expect(main(page)).toHaveAttribute("aria-label", "grid view");
  await expect(page).toHaveURL(/folder=sample/); // corrected to what's actually shown
});
