import { expect, test } from "@playwright/test";

/**
 * LibRaw needs a cross-origin isolated page, so every response must carry
 * the headers, including 304 Not Modified: a module the browser revalidates
 * from its cache without them can't be loaded into a worker (Safari refuses;
 * see vite.config.ts).
 */
const ISOLATION = { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" };

for (const path of [
  "/", // the page
  "/src/main.tsx", // a transformed module
  "/node_modules/libraw-wasm/dist/worker.js?worker_file&type=module", // LibRaw's worker
  "/node_modules/libraw-wasm/dist/libraw.wasm", // served as a static file
  "/icon.svg", // the public folder
]) {
  test(`isolation headers on ${path}, fresh and when not modified`, async ({ request }) => {
    const fresh = await request.get(path);
    expect(fresh.status()).toBe(200);
    expect(fresh.headers()).toMatchObject(ISOLATION);
    const etag = fresh.headers()["etag"];
    expect(etag).toBeTruthy();
    const revalidated = await request.get(path, { headers: { "If-None-Match": etag! } });
    expect(revalidated.status()).toBe(304);
    expect(revalidated.headers()).toMatchObject(ISOLATION);
  });
}
