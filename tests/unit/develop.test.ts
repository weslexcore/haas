import { describe, expect, it } from "vitest";
import { applyAffine, constrainCrop, cropForAspect, cropOutputSize, cropToSourceAffine } from "../../src/core/develop/crop";
import { processPixel, uniformsFor, wbGains, LUMA, computeHistogram } from "../../src/core/develop/pipeline";
import { applyPartial, defaultRecipe, isDefaultRecipe, mergeGroups, normalizeCurve, recipeSchema } from "../../src/core/develop/recipe";
import { curveLut, monotoneCurve } from "../../src/core/develop/tone-curve";
import { createTestRuntime } from "./helpers";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe("recipe", () => {
  it("defaults are valid and neutral", () => {
    expect(recipeSchema.safeParse(defaultRecipe()).success).toBe(true);
    expect(isDefaultRecipe(defaultRecipe())).toBe(true);
    expect(isDefaultRecipe(applyPartial(defaultRecipe(), { exposure: 0.1 }))).toBe(false);
  });

  it("applies partial settings and merges groups", () => {
    const a = applyPartial(defaultRecipe(), { temperature: 30, exposure: 1, hsl: { hue: { red: 20 } } });
    expect(a.hsl.hue).toMatchObject({ red: 20, orange: 0 });
    const b = mergeGroups(defaultRecipe(), a, ["wb"]);
    expect(b.temperature).toBe(30);
    expect(b.exposure).toBe(0);
  });

  it("normalizes curves: sorted, ends at 0 and 1", () => {
    expect(normalizeCurve([[0.6, 0.7], [0.2, 0.1]])).toEqual([[0, 0], [0.2, 0.1], [0.6, 0.7], [1, 1]]);
  });
});

describe("pipeline", () => {
  const neutral = uniformsFor(defaultRecipe());

  it("is the identity with default settings", () => {
    for (const [r, g, b] of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.8], [0.9, 0.1, 0.4]] as const) {
      const out = processPixel(r, g, b, neutral);
      out.forEach((v, i) => expect(Math.abs(v - [r, g, b][i]!)).toBeLessThan(1 / 255));
    }
  });

  it("white balance gains keep luminance", () => {
    const g = wbGains(60, -30);
    expect(near(g[0] * LUMA[0] + g[1] * LUMA[1] + g[2] * LUMA[2], 1)).toBe(true);
    expect(g[0]).toBeGreaterThan(g[2]); // warmer: more red than blue
  });

  it("exposure brightens, highlights recover, shadows lift", () => {
    const mid = processPixel(0.4, 0.4, 0.4, neutral)[0];
    expect(processPixel(0.4, 0.4, 0.4, uniformsFor(applyPartial(defaultRecipe(), { exposure: 1 })))[0]).toBeGreaterThan(mid);
    const bright = applyPartial(defaultRecipe(), { exposure: 1.5 });
    const recovered = applyPartial(bright, { highlights: -100 });
    expect(processPixel(0.8, 0.8, 0.8, uniformsFor(recovered))[0]).toBeLessThan(processPixel(0.8, 0.8, 0.8, uniformsFor(bright))[0]);
    expect(processPixel(0.1, 0.1, 0.1, uniformsFor(applyPartial(defaultRecipe(), { shadows: 100 })))[0]).toBeGreaterThan(0.1);
  });

  it("saturation -100 is greyscale; hue shifts move colours", () => {
    const [r, g, b] = processPixel(0.8, 0.3, 0.2, uniformsFor(applyPartial(defaultRecipe(), { saturation: -100 })));
    expect(near(r, g, 1e-9) && near(g, b, 1e-9)).toBe(true);
    const shifted = processPixel(0.9, 0.1, 0.1, uniformsFor(applyPartial(defaultRecipe(), { hsl: { hue: { red: 100 } } })));
    expect(shifted[1]).toBeGreaterThan(0.1); // red moved towards orange
  });

  it("histogram counts and clipping", () => {
    const h = computeHistogram(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 128, 64, 32, 255]));
    expect(h.total).toBe(3);
    expect(h.clippedShadows).toBe(1);
    expect(h.clippedHighlights).toBe(1);
    expect(h.r[128]).toBe(1);
  });
});

describe("tone curve", () => {
  it("passes through points and never overshoots between them", () => {
    const pts: Array<[number, number]> = [[0, 0], [0.3, 0.6], [0.31, 0.62], [1, 1]];
    const f = monotoneCurve(pts);
    for (const [x, y] of pts) expect(near(f(x), y)).toBe(true);
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = f(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it("identity curve gives an identity LUT", () => {
    const lut = curveLut([[0, 0], [1, 1]]);
    expect(Array.from(lut).every((v, i) => v === i)).toBe(true);
  });
});

describe("crop geometry", () => {
  const src = { width: 3000, height: 2000 };

  it("identity crop maps uv straight through", () => {
    const m = cropToSourceAffine(src, defaultRecipe().crop);
    expect(applyAffine(m, 0.25, 0.75)).toEqual([0.25, 0.75]);
  });

  it("output size follows the crop", () => {
    expect(cropOutputSize(src, { x: 0, y: 0, width: 0.5, height: 0.25, angle: 0 })).toEqual({ width: 1500, height: 500 });
  });

  it("keeps a straightened crop inside the photo", () => {
    const c = constrainCrop(src, { x: 0, y: 0, width: 1, height: 1, angle: 10 });
    expect(c.width).toBeLessThan(1);
    expect(c.width / c.height).toBeCloseTo(1, 5); // shrunk without changing shape
    const m = cropToSourceAffine(src, c);
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const [x, y] = applyAffine(m, u, v);
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(x).toBeLessThanOrEqual(1 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("aspect crops are centred and as large as fit", () => {
    const sq = cropForAspect(src, 1, 0);
    expect(cropOutputSize(src, sq)).toEqual({ width: 2000, height: 2000 });
    expect(sq.x).toBeCloseTo((1 - 2 / 3) / 2);
  });
});

describe("develop actions", () => {
  const editOf = (rt: Awaited<ReturnType<typeof createTestRuntime>>, id = "DSC_0001.jpg") => rt.store.getState().photos.byId[id]!.edit;

  it("adjust sets or nudges, clamped, on the selection", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("library.selection.set", { ids: ["DSC_0001.jpg", "DSC_0002.jpg"] });
    await rt.dispatch("develop.adjust", { setting: "exposure", value: 0.5 });
    await rt.dispatch("develop.adjust", { setting: "exposure", delta: 9 });
    expect(editOf(rt)!.exposure).toBe(5);
    expect(editOf(rt, "DSC_0002.jpg")!.exposure).toBe(5);
    expect(await rt.dispatch("develop.adjust", { setting: "exposure" })).toMatchObject({ ok: false, error: "invalid_params" });
  });

  it("a slider drag is one undo step", async () => {
    const rt = await createTestRuntime();
    for (const v of [10, 20, 30, 40]) await rt.dispatch("develop.adjust", { setting: "contrast", value: v }, { source: "ui" });
    expect(rt.history.entries).toHaveLength(1);
    expect(rt.history.getSnapshot().undoLabel).toBe("Contrast +40");
    await rt.dispatch("history.undo");
    expect(editOf(rt)).toBeUndefined(); // back to unedited
  });

  it("resetting to defaults removes the edit entirely", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("develop.adjust", { setting: "tint", value: 10 });
    await rt.dispatch("develop.adjust", { setting: "tint", value: 0 });
    expect(editOf(rt)).toBeUndefined();
  });

  it("copy/paste and sync skip crop by default", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("develop.settings.apply", { settings: { temperature: 40, crop: { width: 0.5 } } });
    await rt.dispatch("develop.settings.copy");
    await rt.dispatch("library.selection.set", { ids: ["DSC_0003.jpg"] });
    await rt.dispatch("develop.settings.paste");
    expect(editOf(rt, "DSC_0003.jpg")).toMatchObject({ temperature: 40, crop: { width: 1 } });

    await rt.dispatch("library.selection.set", { ids: ["DSC_0001.jpg", "DSC_0004.jpg", "DSC_0005.jpg"], activeId: "DSC_0001.jpg" });
    await rt.dispatch("develop.settings.sync", { groups: ["wb", "crop"] });
    expect(editOf(rt, "DSC_0005.jpg")).toMatchObject({ temperature: 40, crop: { width: 0.5 } });
  });

  it("crop aspect and straighten stay inside the photo", async () => {
    const rt = await createTestRuntime(); // sample photos are 1500×1000
    await rt.dispatch("develop.crop.set", { aspect: "1:1" });
    expect(editOf(rt)!.crop).toMatchObject({ width: expect.closeTo(2 / 3, 5), height: 1 });
    await rt.dispatch("develop.crop.set", { angle: 20 });
    expect(editOf(rt)!.crop.height).toBeLessThan(1);
  });

  it("export renders each photo with its edit and saves it", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("develop.adjust", { setting: "exposure", value: 1 });
    const r = await rt.dispatch<{ exported: number; destination: string }>("develop.export", { maxEdge: 1024 });
    expect(r).toMatchObject({ ok: true, value: { exported: 1, destination: "download" } });
    expect(rt.exports[0]).toMatchObject({ recipe: { exposure: 1 }, opts: { quality: 0.9, maxEdge: 1024 } });
    expect(rt.downloads[0]!.fileName).toBe("DSC_0001.jpg");
  });

  it("settings.get reports the active photo", async () => {
    const rt = await createTestRuntime();
    expect(await rt.dispatch("develop.settings.get")).toMatchObject({ ok: true, value: { edited: false, settings: { exposure: 0 } } });
  });
});
