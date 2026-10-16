import { expect, test } from "@playwright/test";

/**
 * The WebGL2 shader must implement exactly the CPU reference pipeline
 * (core/develop/pipeline.ts). Renders a synthetic image both ways, with a
 * spread of settings, and compares every pixel.
 */
test("GPU develop pipeline matches the CPU reference", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    // Modules are loaded from the dev server; the type casts keep the test type-checked.
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { WebGL2Renderer } = (await load("/src/adapters/render/webgl2-renderer.ts")) as typeof import("../../src/adapters/render/webgl2-renderer");
    const { processImageData } = (await load("/src/core/develop/pipeline.ts")) as typeof import("../../src/core/develop/pipeline");
    const { defaultRecipe, applyPartial } = (await load("/src/core/develop/recipe.ts")) as typeof import("../../src/core/develop/recipe");

    // Hue sweep across, lightness down, plus a grey ramp row band.
    const W = 96;
    const H = 64;
    const c2d = new OffscreenCanvas(W, H).getContext("2d")!;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        c2d.fillStyle = y < 8 ? `rgb(${Math.round((x / (W - 1)) * 255)},${Math.round((x / (W - 1)) * 255)},${Math.round((x / (W - 1)) * 255)})` : `hsl(${(x / W) * 360} ${30 + (y % 5) * 15}% ${8 + ((y - 8) / (H - 8)) * 84}%)`;
        c2d.fillRect(x, y, 1, 1);
      }
    }
    const source = c2d.getImageData(0, 0, W, H);
    const bitmap = await createImageBitmap(source);

    const recipes = {
      neutral: {},
      basic: { exposure: 0.7, contrast: 35, highlights: -60, shadows: 45, whites: 20, blacks: -25 },
      color: { temperature: 40, tint: -20, vibrance: 50, saturation: -30 },
      curve: { toneCurve: [[0, 0.05], [0.3, 0.22], [0.7, 0.82], [1, 0.95]] },
      hsl: { hsl: { hue: { red: 60, blue: -80, green: 40 }, saturation: { orange: -70, aqua: 90 }, luminance: { yellow: 50, purple: -60 } } },
      everything: { exposure: -1.2, contrast: -40, highlights: 80, shadows: -50, temperature: -60, vibrance: -40, saturation: 60, toneCurve: [[0, 0], [0.5, 0.6], [1, 1]], hsl: { hue: { magenta: 100 } } },
    } as const;

    const renderer = new WebGL2Renderer(new OffscreenCanvas(1, 1));
    renderer.setSource(bitmap, { width: W, height: H });
    const out: Record<string, { maxDiff: number; meanDiff: number }> = {};
    for (const [name, partial] of Object.entries(recipes)) {
      const recipe = applyPartial(defaultRecipe(), partial as never);
      renderer.render(recipe);
      const gpu = renderer.readPixels();
      const cpu = new Uint8ClampedArray(source.data);
      processImageData(cpu, recipe);
      let max = 0;
      let sum = 0;
      for (let i = 0; i < cpu.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(cpu[i + k]! - gpu[i + k]!);
          max = Math.max(max, d);
          sum += d;
        }
      }
      out[name] = { maxDiff: max, meanDiff: sum / ((cpu.length / 4) * 3) };
    }
    return out;
  });

  for (const [name, r] of Object.entries(results)) {
    // Float precision and 8-bit LUT filtering differ slightly between GPU and JS.
    expect(r.meanDiff, `${name} mean difference`).toBeLessThan(0.6);
    expect(r.maxDiff, `${name} max difference`).toBeLessThanOrEqual(4);
  }
});

test("crop and straighten map output pixels to the right source pixels", async ({ page }) => {
  await page.goto("/");
  const r = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { WebGL2Renderer } = (await load("/src/adapters/render/webgl2-renderer.ts")) as typeof import("../../src/adapters/render/webgl2-renderer");
    const { defaultRecipe } = (await load("/src/core/develop/recipe.ts")) as typeof import("../../src/core/develop/recipe");
    // Four coloured quadrants.
    const W = 200;
    const H = 100;
    const c = new OffscreenCanvas(W, H).getContext("2d")!;
    const fill = (x: number, y: number, color: string) => ((c.fillStyle = color), c.fillRect(x, y, W / 2, H / 2));
    fill(0, 0, "#ff0000");
    fill(W / 2, 0, "#00ff00");
    fill(0, H / 2, "#0000ff");
    fill(W / 2, H / 2, "#ffffff");
    const renderer = new WebGL2Renderer(new OffscreenCanvas(1, 1));
    renderer.setSource(await createImageBitmap(c.getImageData(0, 0, W, H)), { width: W, height: H });

    const px = (pixels: Uint8Array, w: number, x: number, y: number) => Array.from(pixels.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
    const recipe = defaultRecipe();
    recipe.crop = { x: 0.5, y: 0, width: 0.5, height: 0.5, angle: 0 }; // top-right quadrant only
    const s1 = renderer.render(recipe);
    const p1 = renderer.readPixels();
    // Straighten: the centre stays put, so right of centre still samples the right half.
    recipe.crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5, angle: 30 };
    const s2 = renderer.render(recipe);
    const p2 = renderer.readPixels();
    return {
      size1: s1,
      corner1: px(p1, s1.width, 2, 2),
      size2: s2,
      // Just right of centre in the output should still sample the right half of the source.
      centreRight: px(p2, s2.width, Math.round(s2.width * 0.75), Math.round(s2.height * 0.25)),
    };
  });
  expect(r.size1).toEqual({ width: 100, height: 50 });
  expect(r.corner1).toEqual([0, 255, 0]);
  expect(r.size2).toEqual({ width: 100, height: 50 });
  expect(r.centreRight[1]).toBeGreaterThan(200); // green/white quadrant side
});
