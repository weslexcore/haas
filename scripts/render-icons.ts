/**
 * Renders public/icon.svg to the PNG app icons the PWA manifest lists.
 * Run after changing the icon: `yarn icons` (needs Playwright's Chromium).
 */
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const svg = await readFile(new URL("../public/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    const path = new URL(`../public/icon-${size}.png`, import.meta.url).pathname;
    await page.screenshot({ path, omitBackground: true });
    console.log(`✓ wrote public/icon-${size}.png`);
    await page.close();
  }
} finally {
  await browser.close();
}
