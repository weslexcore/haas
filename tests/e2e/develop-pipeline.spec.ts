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
    const { defaultRecipe, applyPartial, lookSchema, applyPartialAdjustments, defaultMaskAdjustments, partialMaskAdjustmentsSchema } = (await load("/src/core/develop/recipe.ts")) as typeof import("../../src/core/develop/recipe");
    const { BUILTIN_PROFILES } = (await load("/src/core/develop/profiles.ts")) as typeof import("../../src/core/develop/profiles");

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
    const bitmap0 = await createImageBitmap(source);

    const recipes = {
      neutral: {},
      basic: { exposure: 0.7, contrast: 35, highlights: -60, shadows: 45, whites: 20, blacks: -25 },
      color: { temperature: 40, tint: -20, vibrance: 50, saturation: -30 },
      curve: { toneCurve: [[0, 0.05], [0.3, 0.22], [0.7, 0.82], [1, 0.95]] },
      hsl: { hsl: { hue: { red: 60, blue: -80, green: 40 }, saturation: { orange: -70, aqua: 90 }, luminance: { yellow: 50, purple: -60 } } },
      vignetteDark: { vignette: -75 },
      vignetteLight: { vignette: 60 },
      everything: { exposure: -1.2, contrast: -40, highlights: 80, shadows: -50, temperature: -60, vibrance: -40, saturation: 60, vignette: -50, toneCurve: [[0, 0], [0.5, 0.6], [1, 1]], hsl: { hue: { magenta: 100 } } },
    } as const;

    // Every built-in profile (on top of some slider settings), plus extreme looks: heavy grain and toning, amount 200.
    type Recipe = ReturnType<typeof defaultRecipe>;
    const profiled: Record<string, Recipe> = {};
    const withProfile = (id: string, name: string, look: import("../../src/core/develop/recipe").Look, amount = 100): Recipe => ({
      ...applyPartial(defaultRecipe(), { exposure: 0.3, contrast: 15, saturation: 10 }),
      profile: { id, name, amount, look },
    });
    for (const p of BUILTIN_PROFILES) profiled[`profile ${p.name}`] = withProfile(p.id, p.name, p.look);
    profiled["profile extreme"] = withProfile(
      "user.extreme",
      "Extreme",
      lookSchema.parse({
        saturation: -60,
        fade: 40,
        curves: { red: [[0, 0.1], [0.5, 0.7], [1, 1]], blue: [[0, 0], [0.4, 0.2], [1, 0.8]] },
        splitToning: { shadowHue: 200, shadowSaturation: 100, highlightHue: 30, highlightSaturation: 100, balance: -50 },
        grain: { amount: 100, size: 0 },
      }),
      200,
    );
    profiled["profile mono grain"] = withProfile("user.mono", "Mono", lookSchema.parse({ monochrome: { red: 120, green: -40, blue: 20 }, grain: { amount: 80, size: 100 } }), 150);

    // Masks: every shape, inverted, stacked, disabled, with curves and HSL inside, and a bitmap (segment) mask.
    type Mask = import("../../src/core/develop/recipe").Mask;
    const adj = (a: Record<string, unknown>) => applyPartialAdjustments(defaultMaskAdjustments(), partialMaskAdjustmentsSchema.parse(a));
    const mask = (id: string, shape: Mask["shape"], adjustments: Record<string, unknown>, extra: Partial<Mask> = {}): Mask => ({ id, name: "", enabled: true, invert: false, shape, adjustments: adj(adjustments), ...extra });
    const withMasks = (masks: Mask[]): Recipe => ({ ...applyPartial(defaultRecipe(), { exposure: 0.2, contrast: 10, vignette: -30 }), masks });
    // An 8×8 bitmap: coverage rising left to right, with the bottom row empty.
    const bitmap = { width: 8, height: 8, data: new Uint8ClampedArray(64).map((_, i) => (i >= 56 ? 0 : Math.round(((i % 8) / 7) * 255))) };
    const masked: Record<string, Recipe> = {
      "mask linear": withMasks([mask("a", { type: "linear", from: { x: 0.5, y: 0.1 }, to: { x: 0.5, y: 0.7 } }, { exposure: -1.5, saturation: -50 })]),
      "mask radial inverted": withMasks([mask("a", { type: "radial", center: { x: 0.4, y: 0.5 }, radiusX: 0.25, radiusY: 0.35, angle: 30, feather: 60 }, { temperature: 60, shadows: 50, toneCurve: [[0, 0.1], [0.5, 0.4], [1, 1]] }, { invert: true })]),
      "mask luminance": withMasks([mask("a", { type: "luminance", low: 30, high: 70, feather: 15 }, { contrast: 60, hsl: { hue: { blue: 80, green: -60 }, saturation: { red: 70 }, luminance: { yellow: -50 } } })]),
      "mask colour": withMasks([mask("a", { type: "color", hue: 120, range: 60, feather: 50 }, { saturation: -100, exposure: 0.5 })]),
      "mask segment": withMasks([mask("seg", { type: "segment", target: "sky" }, { exposure: -2, tint: -40 })]),
      "masks stacked": withMasks([
        mask("a", { type: "linear", from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } }, { exposure: 2 }),
        mask("b", { type: "radial", center: { x: 0.5, y: 0.5 }, radiusX: 0.4, radiusY: 0.4, angle: 0, feather: 0 }, { exposure: -3, contrast: -80, toneCurve: [[0, 0], [0.5, 0.7], [1, 1]] }),
        mask("c", { type: "luminance", low: 0, high: 100, feather: 20 }, { exposure: 5 }, { enabled: false }),
        mask("seg", { type: "segment", target: "subject" }, { highlights: -80, whites: 40, blacks: -40, vibrance: 80, hsl: { hue: { red: 100 } } }),
        mask("d", { type: "color", hue: 0, range: 40, feather: 0 }, {}),
      ]),
    };

    const renderer = new WebGL2Renderer(new OffscreenCanvas(1, 1));
    renderer.setSource(bitmap0, { width: W, height: H });
    renderer.setMaskBitmaps({ seg: bitmap });
    const out: Record<string, { maxDiff: number; meanDiff: number }> = {};
    const all: Array<[string, Recipe]> = [...Object.entries(recipes).map(([name, partial]) => [name, applyPartial(defaultRecipe(), partial as never)] as [string, Recipe]), ...Object.entries(profiled), ...Object.entries(masked)];
    for (const [name, recipe] of all) {
      renderer.render(recipe);
      const gpu = renderer.readPixels();
      const cpu = new Uint8ClampedArray(source.data);
      processImageData(cpu, recipe, W, { seg: bitmap });
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

    // The mask overlay paints coverage in red: full at the top of the linear mask, nothing below it.
    const overlay = masked["mask linear"]!;
    renderer.render(overlay);
    const plain = renderer.readPixels();
    renderer.render(overlay, { showMask: "a" });
    const painted = renderer.readPixels();
    const redness = (px: Uint8Array, x: number, y: number) => px[(y * W + x) * 4]! - px[(y * W + x) * 4 + 1]!;
    const top = redness(painted, 48, 2) - redness(plain, 48, 2);
    const bottom = redness(painted, 48, H - 2) - redness(plain, 48, H - 2);
    return { out, top, bottom };
  });

  for (const [name, r] of Object.entries(results.out)) {
    // Float precision and 8-bit LUT filtering differ slightly between GPU and JS.
    expect(r.meanDiff, `${name} mean difference`).toBeLessThan(0.6);
    expect(r.maxDiff, `${name} max difference`).toBeLessThanOrEqual(4);
  }
  expect(results.top).toBeGreaterThan(40);
  expect(results.bottom).toBe(0);
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
