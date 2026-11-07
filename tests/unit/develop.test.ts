import { describe, expect, it } from "vitest";
import { applyAffine, constrainCrop, cropForAspect, cropOutputSize, cropToSourceAffine, levelAngle, resizeCrop, rotateByDrag } from "../../src/core/develop/crop";
import { processPixel, uniformsFor, vignetteMask, wbGains, LUMA, computeHistogram } from "../../src/core/develop/pipeline";
import { applyPartial, defaultRecipe, isDefaultRecipe, mergeGroups, normalizeCurve, recipeSchema } from "../../src/core/develop/recipe";
import { curveLut, monotoneCurve } from "../../src/core/develop/tone-curve";
import { createTestRuntime, flush } from "./helpers";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe("recipe", () => {
  it("defaults are valid and neutral", () => {
    expect(recipeSchema.safeParse(defaultRecipe()).success).toBe(true);
    // A recipe saved before a slider existed still parses, with that slider neutral.
    const { vignette: _, ...old } = defaultRecipe();
    expect(recipeSchema.parse(old).vignette).toBe(0);
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

  it("vignette leaves the centre alone and darkens or lightens the corners", () => {
    expect(vignetteMask(0.5, 0.5)).toBe(0);
    expect(vignetteMask(0, 0)).toBeCloseTo(1, 6);
    expect(vignetteMask(1, 1)).toBeCloseTo(1, 6);
    expect(vignetteMask(0.5, 0)).toBeGreaterThan(0);
    expect(vignetteMask(0.5, 0)).toBeLessThan(vignetteMask(0, 0));
    const dark = uniformsFor(applyPartial(defaultRecipe(), { vignette: -100 }));
    expect(processPixel(0.5, 0.5, 0.5, dark, vignetteMask(0.5, 0.5))[0]).toBeCloseTo(0.5, 2);
    expect(processPixel(0.5, 0.5, 0.5, dark, vignetteMask(0, 0))[0]).toBeCloseTo(0, 6);
    const light = uniformsFor(applyPartial(defaultRecipe(), { vignette: 100 }));
    expect(processPixel(0.5, 0.5, 0.5, light, vignetteMask(0, 0))[0]).toBeCloseTo(1, 6);
    expect(processPixel(0.5, 0.5, 0.5, light, 0.5)[0]).toBeGreaterThan(0.5);
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

  it("dragging clockwise around the centre rotates clockwise", () => {
    const c = { x: 0, y: 0 };
    expect(rotateByDrag(0, c, { x: 100, y: 0 }, { x: 100, y: 10 })).toBeCloseTo(5.71, 1);
    expect(rotateByDrag(3, c, { x: 100, y: 0 }, { x: 100, y: -10 })).toBeCloseTo(3 - 5.71, 1);
    // Across the ±180° seam, and clamped to ±45.
    expect(rotateByDrag(0, c, { x: -100, y: -1 }, { x: -100, y: 1 })).toBeCloseTo(-1.15, 1);
    expect(rotateByDrag(40, c, { x: 100, y: 0 }, { x: 0, y: 100 })).toBe(45);
  });

  it("levels a line to the nearest horizontal or vertical", () => {
    // A horizon dropping 2% of the height over the full width (y down): tilted clockwise.
    const tilt = (Math.atan2(0.02 * 2000, 3000) * 180) / Math.PI;
    expect(levelAngle(src, 0, { x: 0, y: 0.5 }, { x: 1, y: 0.52 })).toBeCloseTo(-tilt, 1);
    // Same line drawn right to left gives the same answer.
    expect(levelAngle(src, 0, { x: 1, y: 0.52 }, { x: 0, y: 0.5 })).toBeCloseTo(-tilt, 1);
    // Relative to the current angle.
    expect(levelAngle(src, 2, { x: 0, y: 0.5 }, { x: 1, y: 0.52 })).toBeCloseTo(2 - tilt, 1);
    // A near-vertical edge whose top leans right is also tilted clockwise.
    expect(levelAngle(src, 0, { x: 0.5, y: 1 }, { x: 0.52, y: 0 })).toBeCloseTo(-(Math.atan2(0.02 * 3000, 2000) * 180) / Math.PI, 1);
    expect(levelAngle(src, 0, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 })).toBeNull();
  });

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

  describe("resizing by a handle", () => {
    const start = { x: 0.2, y: 0.2, width: 0.6, height: 0.4, angle: 0 };
    const shape = (c: { width: number; height: number }) => c.width / c.height;

    it("free: only the dragged edges move, never past the opposite edge or the frame", () => {
      expect(resizeCrop(start, "e", 0.1, 0.3)).toMatchObject({ x: 0.2, y: 0.2, width: expect.closeTo(0.7), height: 0.4 });
      expect(resizeCrop(start, "nw", -0.1, -0.1)).toMatchObject({ x: expect.closeTo(0.1), y: expect.closeTo(0.1), width: expect.closeTo(0.7), height: expect.closeTo(0.5) });
      expect(resizeCrop(start, "e", 0.5, 0)).toMatchObject({ width: expect.closeTo(0.8) }); // stops at the frame edge
      expect(resizeCrop(start, "w", 0.9, 0)).toMatchObject({ x: expect.closeTo(0.78), width: expect.closeTo(0.02) }); // never inverts
    });

    it("locked corner: keeps the shape about the opposite corner, sliding along the diagonal", () => {
      const c = resizeCrop(start, "se", -0.3, -0.05, true);
      expect(shape(c)).toBeCloseTo(shape(start));
      expect(c).toMatchObject({ x: 0.2, y: 0.2 }); // the north-west corner stays
      // The wanted corner (0.3 × 0.35 from the anchor) projected onto the 3:2 diagonal.
      const t = (0.3 * 1.5 + 0.35) / (1.5 * 1.5 + 1);
      expect(c.height).toBeCloseTo(t);
      expect(c.width).toBeCloseTo(t * 1.5);
      // Moving along the diagonal itself lands the corner on the pointer.
      expect(resizeCrop(start, "se", 0.15, 0.1, true)).toMatchObject({ width: expect.closeTo(0.75), height: expect.closeTo(0.5) });
      const nw = resizeCrop(start, "nw", 0.3, 0, true);
      expect(shape(nw)).toBeCloseTo(shape(start));
      expect(nw.x + nw.width).toBeCloseTo(0.8); // the south-east corner stays
      expect(nw.y + nw.height).toBeCloseTo(0.6);
    });

    it("locked edge: the other dimension scales about its centre", () => {
      const c = resizeCrop(start, "e", 0.15, 0, true);
      expect(shape(c)).toBeCloseTo(shape(start));
      expect(c).toMatchObject({ x: 0.2, width: expect.closeTo(0.75), height: expect.closeTo(0.5) });
      expect(c.y + c.height / 2).toBeCloseTo(0.4); // same vertical centre
      const n = resizeCrop(start, "n", 0.4, 0.1, true);
      expect(n.y + n.height).toBeCloseTo(0.6); // the bottom edge stays
      expect(n.x + n.width / 2).toBeCloseTo(0.5);
      expect(n.height).toBeCloseTo(0.3);
    });

    it("locked: growing stops where either dimension meets the frame, and never collapses", () => {
      // Dragging the right edge out: the right edge reaches the frame first.
      const c = resizeCrop(start, "e", 0.9, 0, true);
      expect(shape(c)).toBeCloseTo(shape(start));
      expect(c.x + c.width).toBeCloseTo(1);
      expect(c.height).toBeCloseTo(0.8 / 1.5);
      expect(c.y + c.height / 2).toBeCloseTo(0.4);
      // A square near the top: the top edge reaches the frame first (0.2 of room above the centre).
      const top = resizeCrop({ x: 0.1, y: 0.05, width: 0.3, height: 0.3, angle: 0 }, "e", 0.9, 0, true);
      expect(top).toMatchObject({ x: 0.1, y: expect.closeTo(0), width: expect.closeTo(0.4), height: expect.closeTo(0.4) });
      const tiny = resizeCrop(start, "se", -1, -1, true);
      expect(tiny.height).toBeCloseTo(0.02);
      expect(shape(tiny)).toBeCloseTo(shape(start));
    });
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

  it("straightens along a drawn line, in one undo step", async () => {
    const rt = await createTestRuntime(); // 1500×1000
    await rt.dispatch("develop.crop.level", { from: { x: 0.1, y: 0.5 }, to: { x: 0.9, y: 0.54 } });
    const crop = editOf(rt)!.crop;
    expect(crop.angle).toBeCloseTo(-(Math.atan2(0.04 * 1000, 0.8 * 1500) * 180) / Math.PI, 1);
    expect(crop.width).toBeLessThan(1); // shrunk to stay inside the rotated photo
    expect(rt.history.getSnapshot().undoLabel).toBe("Straighten");
    await rt.dispatch("history.undo");
    expect(editOf(rt)).toBeUndefined();
  });

  it("the straighten tool opens the crop overlay and closes with it", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("view.set", { view: "develop" });
    expect(await rt.dispatch("develop.levelTool.toggle")).toMatchObject({ ok: true });
    expect(rt.store.getState().develop).toMatchObject({ levelTool: true, cropTool: true });
    await rt.dispatch("develop.cropTool.toggle");
    expect(rt.store.getState().develop).toMatchObject({ levelTool: false, cropTool: false });
  });

  it("cropping is available in Loupe and Develop, not Grid", async () => {
    const rt = await createTestRuntime();
    expect(await rt.dispatch("develop.cropTool.toggle")).toMatchObject({ ok: false }); // grid
    await rt.dispatch("view.set", { view: "loupe" });
    expect(await rt.dispatch("develop.cropTool.toggle")).toMatchObject({ ok: true });
    expect(rt.store.getState()).toMatchObject({ view: "loupe", develop: { cropTool: true } });
  });

  it("export renders each photo with its edit and saves it", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("develop.adjust", { setting: "exposure", value: 1 });
    const r = await rt.dispatch<{ exported: number; destination: string }>("develop.export", { maxEdge: 1024 });
    expect(r).toMatchObject({ ok: true, value: { exported: 1, total: 1, destination: "download", cancelled: false } });
    expect(rt.exports[0]).toMatchObject({ recipe: { exposure: 1 }, opts: { quality: 0.9, maxEdge: 1024 } });
    expect(rt.downloads[0]!.fileName).toBe("DSC_0001.jpg");
    expect(rt.store.getState().develop.exportJob).toBeNull();
  });

  it("exports every selected photo, each with its own edit, in selection order", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("develop.adjust", { setting: "exposure", value: 1, photoIds: ["DSC_0002.jpg"] });
    await rt.dispatch("library.selection.set", { ids: ["DSC_0003.jpg", "DSC_0001.jpg", "DSC_0002.jpg"] });
    const r = await rt.dispatch<{ exported: number; files: Array<{ photoId: string }> }>("develop.export");
    expect(r).toMatchObject({ ok: true, value: { exported: 3, total: 3 } });
    expect(r.ok && r.value.files.map((f) => f.photoId)).toEqual(["DSC_0003.jpg", "DSC_0001.jpg", "DSC_0002.jpg"]);
    expect(rt.exports.map((e) => (e.recipe as { exposure: number }).exposure)).toEqual([0, 0, 1]);
    expect(rt.downloads.map((d) => d.fileName)).toEqual(["DSC_0003.jpg", "DSC_0001.jpg", "DSC_0002.jpg"]);
  });

  it("a bulk export shows progress, runs alone, and can be cancelled between photos", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("library.selection.set", { ids: ["DSC_0001.jpg", "DSC_0002.jpg", "DSC_0003.jpg"] });
    expect(await rt.dispatch("develop.export.cancel")).toMatchObject({ ok: false, error: "unavailable" }); // nothing running
    // Hold every render until the test lets go.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const render = rt.services.exporter.renderJpeg;
    rt.services.exporter.renderJpeg = async (...args) => {
      await gate;
      return render(...args);
    };
    const run = rt.dispatch<{ exported: number; total: number; cancelled: boolean }>("develop.export");
    await flush();
    expect(rt.store.getState().develop.exportJob).toMatchObject({ done: 0, total: 3, failed: 0, cancelRequested: false });
    expect(await rt.dispatch("develop.export")).toMatchObject({ ok: false, error: "unavailable" }); // one at a time
    expect(await rt.dispatch("develop.export.cancel")).toMatchObject({ ok: true });
    expect(rt.store.getState().develop.exportJob).toMatchObject({ cancelRequested: true });
    release();
    expect(await run).toMatchObject({ ok: true, value: { exported: 1, total: 3, cancelled: true } });
    expect(rt.downloads).toHaveLength(1); // the photo being written finished; the rest were skipped
    expect(rt.store.getState().develop.exportJob).toBeNull();
  });

  it("export keeps going when one photo fails, and clears its progress on the way out", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("library.selection.set", { ids: ["DSC_0001.jpg", "DSC_0002.jpg"] });
    const render = rt.services.exporter.renderJpeg;
    rt.services.exporter.renderJpeg = async (image, recipe, opts) => {
      if (rt.exports.length === 0) {
        rt.exports.push({ recipe, opts });
        throw new Error("GPU lost");
      }
      return render(image, recipe, opts);
    };
    const r = await rt.dispatch("develop.export");
    expect(r).toMatchObject({ ok: true, value: { exported: 1, failed: [{ path: "DSC_0001.jpg", error: "GPU lost" }] } });
    expect(rt.store.getState().develop.exportJob).toBeNull();
  });

  it("settings.get reports the active photo", async () => {
    const rt = await createTestRuntime();
    expect(await rt.dispatch("develop.settings.get")).toMatchObject({ ok: true, value: { edited: false, settings: { exposure: 0 } } });
  });
});
