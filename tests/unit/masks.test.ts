import { describe, expect, it } from "vitest";
import { defaultShape, hasAdjustments, maskLabel, maskWeight, newMaskId, resampleBitmap, sampleBitmap, type MaskBitmap } from "../../src/core/develop/masks";
import { localParams, maskWeights, processImageData, processPixel, toneParams, uniformsFor } from "../../src/core/develop/pipeline";
import { applyPartial, applyPartialAdjustments, defaultMaskAdjustments, defaultRecipe, isDefaultRecipe, maskSchema, mergeGroups, recipeSchema, type Mask, type MaskShape } from "../../src/core/develop/recipe";
import { createTestRuntime, fakeMaskBitmap, flush, makeImage } from "./helpers";

const mask = (shape: MaskShape, adjustments: Parameters<typeof applyPartialAdjustments>[1] = {}, extra: Partial<Mask> = {}): Mask => ({
  id: "m1",
  name: "",
  enabled: true,
  invert: false,
  shape,
  adjustments: applyPartialAdjustments(defaultMaskAdjustments(), adjustments),
  ...extra,
});
const grey: [number, number, number] = [0.5, 0.5, 0.5];

describe("mask schema", () => {
  it("recipes saved before masks existed parse with none; a mask gets its defaults", () => {
    const { masks: _, ...old } = defaultRecipe();
    expect(recipeSchema.parse(old).masks).toEqual([]);
    const m = maskSchema.parse({ id: "a", shape: { type: "segment", target: "sky" } });
    expect(m).toMatchObject({ name: "", enabled: true, invert: false, adjustments: { exposure: 0, toneCurve: [[0, 0], [1, 1]], hsl: { hue: { blue: 0 } } } });
    const radial = maskSchema.parse({ id: "a", shape: { type: "radial", center: { x: 0.5, y: 0.5 }, radiusX: 0.2, radiusY: 0.2 } });
    expect(radial.shape).toMatchObject({ angle: 0, feather: 50 });
    expect(recipeSchema.safeParse({ ...defaultRecipe(), masks: Array.from({ length: 9 }, (_, i) => maskSchema.parse({ id: `m${i}`, shape: { type: "segment", target: "sky" } })) }).success).toBe(false);
  });

  it("a recipe with a mask is edited; masks are a settings group", () => {
    const r = { ...defaultRecipe(), masks: [mask({ type: "segment", target: "sky" })] };
    expect(isDefaultRecipe(r)).toBe(false);
    expect(mergeGroups(defaultRecipe(), r, ["masks"]).masks).toHaveLength(1);
    expect(mergeGroups(r, defaultRecipe(), ["masks"]).masks).toHaveLength(0);
    expect(applyPartial(r, { masks: [] }).masks).toEqual([]);
    expect(hasAdjustments(r.masks[0]!)).toBe(false);
    expect(hasAdjustments(mask({ type: "segment", target: "sky" }, { hsl: { luminance: { blue: -10 } } }))).toBe(true);
  });

  it("labels, default shapes and ids", () => {
    expect(maskLabel(mask({ type: "segment", target: "sky" }))).toBe("Sky");
    expect(maskLabel(mask({ type: "linear", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }, {}, { name: "Horizon" }))).toBe("Horizon");
    expect(maskSchema.parse({ id: "a", shape: defaultShape("radial") }).shape.type).toBe("radial");
    expect(defaultShape("segment", "water")).toEqual({ type: "segment", target: "water" });
    const ids = new Set(Array.from({ length: 50 }, () => newMaskId()));
    expect(ids.size).toBe(50);
    expect(newMaskId([mask({ type: "segment", target: "sky" }, {}, { id: "m1" })])).not.toBe("m1");
  });
});

describe("mask coverage", () => {
  it("linear: full before the start, half way between, nothing past the end; measured in the photo's shape", () => {
    const m = mask({ type: "linear", from: { x: 0.5, y: 0.2 }, to: { x: 0.5, y: 0.6 } });
    expect(maskWeight(m, 0.1, 0.1, grey, 1.5)).toBe(1);
    expect(maskWeight(m, 0.9, 0.4, grey, 1.5)).toBeCloseTo(0.5, 6);
    expect(maskWeight(m, 0.5, 0.8, grey, 1.5)).toBe(0);
    // A horizontal gradient on a 2:1 photo: the same uv distance is twice as far, so the ramp is in pixels, not uv.
    const h = mask({ type: "linear", from: { x: 0.25, y: 0.5 }, to: { x: 0.75, y: 0.5 } });
    expect(maskWeight(h, 0.5, 0.1, grey, 2)).toBeCloseTo(0.5, 6);
    expect(maskWeight(h, 0.375, 0.9, grey, 2)).toBeCloseTo(0.75, 6);
    expect(maskWeight({ ...h, invert: true }, 0.375, 0.9, grey, 2)).toBeCloseTo(0.25, 6);
  });

  it("radial: full at the centre, feathered to the edge, round on screen", () => {
    const m = mask({ type: "radial", center: { x: 0.5, y: 0.5 }, radiusX: 0.2, radiusY: 0.4, angle: 0, feather: 0 });
    expect(maskWeight(m, 0.5, 0.5, grey, 2)).toBe(1);
    // Just inside the horizontal radius (0.2 of the width) and just outside.
    expect(maskWeight(m, 0.69, 0.5, grey, 2)).toBe(1);
    expect(maskWeight(m, 0.71, 0.5, grey, 2)).toBe(0);
    expect(maskWeight(m, 0.5, 0.89, grey, 2)).toBe(1);
    expect(maskWeight(m, 0.5, 0.91, grey, 2)).toBe(0);
    const soft = { ...m, shape: { ...m.shape, feather: 100 } };
    expect(maskWeight(soft, 0.6, 0.5, grey, 2)).toBeCloseTo(0.5, 6); // half way out on a full feather
    expect(maskWeight(soft, 0.75, 0.5, grey, 2)).toBe(0);
    // Rotated 90°: the long axis now runs horizontally (0.4 of the height = 0.2 of the width on a 2:1 photo).
    const turned = { ...m, shape: { ...m.shape, angle: 90, radiusX: 0.1, radiusY: 0.4 } };
    expect(maskWeight(turned, 0.69, 0.5, grey, 2)).toBe(1);
    expect(maskWeight(turned, 0.5, 0.71, grey, 2)).toBe(0);
  });

  it("luminance and colour ranges read the original pixel", () => {
    const shadows = mask({ type: "luminance", low: 0, high: 30, feather: 10 });
    expect(maskWeight(shadows, 0, 0, [0.1, 0.1, 0.1], 1)).toBe(1);
    expect(maskWeight(shadows, 0, 0, [0.35, 0.35, 0.35], 1)).toBeCloseTo(0.5, 6);
    expect(maskWeight(shadows, 0, 0, [0.8, 0.8, 0.8], 1)).toBe(0);
    const mids = mask({ type: "luminance", low: 40, high: 60, feather: 0 });
    expect(maskWeight(mids, 0, 0, grey, 1)).toBe(1);
    expect(maskWeight(mids, 0, 0, [0.3, 0.3, 0.3], 1)).toBe(0);

    const reds = mask({ type: "color", hue: 0, range: 40, feather: 50 });
    expect(maskWeight(reds, 0, 0, [1, 0, 0], 1)).toBe(1);
    expect(maskWeight(reds, 0, 0, [1, 0, 0.3], 1)).toBe(1); // 342°: inside the range, across the seam
    expect(maskWeight(reds, 0, 0, [0, 0, 1], 1)).toBe(0);
    expect(maskWeight(reds, 0, 0, grey, 1)).toBe(0); // no colour
    expect(maskWeight(reds, 0, 0, [1, 0.6, 0], 1)).toBeGreaterThan(0); // 36°: in the feather
    expect(maskWeight(reds, 0, 0, [1, 0.6, 0], 1)).toBeLessThan(1);
  });

  it("segment masks sample their bitmap bilinearly, or cover nothing without one", () => {
    const m = mask({ type: "segment", target: "sky" });
    const bitmap = fakeMaskBitmap(); // top half on
    expect(maskWeight(m, 0.5, 0.1, grey, 1, bitmap)).toBe(1);
    expect(maskWeight(m, 0.5, 0.9, grey, 1, bitmap)).toBe(0);
    expect(maskWeight(m, 0.5, 0.5, grey, 1, bitmap)).toBeCloseTo(0.5, 6);
    expect(maskWeight(m, 0.5, 0.1, grey, 1)).toBe(0);
    expect(maskWeight({ ...m, invert: true }, 0.5, 0.1, grey, 1)).toBe(1);
    const two: MaskBitmap = { width: 2, height: 1, data: new Uint8ClampedArray([0, 255]) };
    expect(sampleBitmap(two, 0.5, 0.5)).toBeCloseTo(0.5, 6);
    expect(sampleBitmap(two, 0, 0.5)).toBe(0);
    expect(resampleBitmap(two, 4, 2).data).toEqual(new Uint8ClampedArray([0, 0, 255, 255, 0, 0, 255, 255]));
  });
});

describe("masks in the pipeline", () => {
  const px: [number, number, number] = [0.4, 0.5, 0.6];

  it("inside a mask the sliders add to the photo's; outside nothing changes", () => {
    const masked = uniformsFor({ ...defaultRecipe(), exposure: 0.5, masks: [mask({ type: "segment", target: "sky" }, { exposure: 1, temperature: 30 })] });
    const same = uniformsFor(applyPartial(defaultRecipe(), { exposure: 1.5, temperature: 30 }));
    const plain = uniformsFor(applyPartial(defaultRecipe(), { exposure: 0.5 }));
    expect(processPixel(...px, masked, 0, 0, [1])).toEqual(processPixel(...px, same));
    expect(processPixel(...px, masked, 0, 0, [0])).toEqual(processPixel(...px, plain));
    expect(processPixel(...px, masked)).toEqual(processPixel(...px, plain));
    // Half coverage: half the offset.
    expect(processPixel(...px, masked, 0, 0, [0.5])).toEqual(processPixel(...px, uniformsFor(applyPartial(defaultRecipe(), { exposure: 1, temperature: 15 }))));
  });

  it("disabled masks and masks without adjustments change nothing; sums stay within the slider ranges", () => {
    const off = uniformsFor({ ...defaultRecipe(), masks: [mask({ type: "segment", target: "sky" }, { exposure: 2 }, { enabled: false }), mask({ type: "segment", target: "sky" })] });
    expect(off.masks.map((m) => m.active)).toEqual([false, false]);
    expect(processPixel(...px, off, 0, 0, [1, 1])).toEqual(processPixel(...px, uniformsFor(defaultRecipe())));
    const over = uniformsFor({ ...defaultRecipe(), exposure: 4, masks: [mask({ type: "segment", target: "sky" }, { exposure: 3, blacks: 100 }), mask({ type: "segment", target: "sky" }, { blacks: 100 })] });
    expect(localParams(over, [1, 1]).tone).toEqual(toneParams(uniformsFor(applyPartial(defaultRecipe(), { exposure: 5, blacks: 100 })).sliders));
  });

  it("a mask's tone curve and HSL blend in by coverage", () => {
    const curved = uniformsFor({ ...defaultRecipe(), masks: [mask({ type: "segment", target: "sky" }, { toneCurve: [[0, 0.2], [1, 1]] })] });
    const full = localParams(curved, [1]).curve(0);
    expect(full).toBeCloseTo(0.2, 2);
    expect(localParams(curved, [0.5]).curve(0)).toBeCloseTo(0.1, 2);
    expect(processPixel(0, 0, 0, curved, 0, 0, [1])[0]).toBeGreaterThan(processPixel(0, 0, 0, curved)[0]);
    const hsl = uniformsFor({ ...defaultRecipe(), masks: [mask({ type: "segment", target: "sky" }, { hsl: { saturation: { blue: -100 } } })] });
    const [r, g, b] = processPixel(0.1, 0.1, 0.9, hsl, 0, 0, [1]);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.02); // the blue is drained
    expect(processPixel(0.1, 0.1, 0.9, hsl, 0, 0, [0])).toEqual(processPixel(0.1, 0.1, 0.9, uniformsFor(defaultRecipe())));
  });

  it("processImageData applies masks by position: a top-down gradient darkens the top only", () => {
    const img = makeImage(8, 8, () => [128, 128, 128]);
    const recipe = { ...defaultRecipe(), masks: [mask({ type: "linear", from: { x: 0.5, y: 0.1 }, to: { x: 0.5, y: 0.6 } }, { exposure: -2 })] };
    const data = new Uint8ClampedArray(img.data);
    processImageData(data, recipe, 8);
    expect(data[0]).toBeLessThan(80); // top row: fully covered
    expect(data[(7 * 8) * 4]).toBe(128); // bottom row: untouched
    expect(data[(3 * 8) * 4]).toBeGreaterThan(data[0]!);
    expect(data[(3 * 8) * 4]).toBeLessThan(128);
    const u = uniformsFor(recipe);
    expect(maskWeights(u, 0.5, 0.05, grey, 1)).toEqual([1]);
  });
});

describe("mask actions", () => {
  const sky = { type: "segment", target: "sky" } as const;

  it("add returns an id, selects it, and is undoable; update coalesces; remove", async () => {
    const rt = await createTestRuntime({ photos: 3 });
    const id = rt.store.getState().selection.activeId!;
    const added = await rt.dispatch<{ maskId: string }>("develop.mask.add", { shape: sky, adjustments: { exposure: -0.7 } });
    expect(added.ok).toBe(true);
    const maskId = (added as { value: { maskId: string } }).value.maskId;
    expect(rt.store.getState().develop.maskTool.selectedId).toBe(maskId);
    const recipe = () => rt.store.getState().photos.byId[id]!.edit!;
    expect(recipe().masks[0]).toMatchObject({ id: maskId, shape: sky, adjustments: { exposure: -0.7, contrast: 0 } });
    expect(maskLabel(recipe().masks[0]!)).toBe("Sky");

    // Two slider moves on the same setting are one undo step; the shape change another.
    await rt.dispatch("develop.mask.update", { maskId, adjustments: { contrast: 10 } });
    await rt.dispatch("develop.mask.update", { maskId, adjustments: { contrast: 25 } });
    await rt.dispatch("develop.mask.update", { maskId, shape: { type: "segment", target: "water" }, name: "Lake" });
    expect(recipe().masks[0]).toMatchObject({ adjustments: { contrast: 25, exposure: -0.7 }, shape: { target: "water" }, name: "Lake" });
    await rt.dispatch("history.undo");
    expect(recipe().masks[0]).toMatchObject({ adjustments: { contrast: 25 }, shape: sky, name: "" });
    await rt.dispatch("history.undo");
    expect(recipe().masks[0]!.adjustments.contrast).toBe(0);
    await rt.dispatch("history.undo");
    expect(rt.store.getState().photos.byId[id]!.edit).toBeUndefined();
    await rt.dispatch("history.redo");
    expect(recipe().masks).toHaveLength(1);

    await rt.dispatch("develop.mask.remove", { maskId });
    expect(rt.store.getState().photos.byId[id]!.edit).toBeUndefined();
    expect(rt.store.getState().develop.maskTool.selectedId).toBeNull();
    const missing = await rt.dispatch("develop.mask.update", { maskId, enabled: false });
    expect(missing).toMatchObject({ ok: false, error: "failed" });
  });

  it("the same mask goes onto every selected photo; reset, duplicate, sync and the mask limit", async () => {
    const rt = await createTestRuntime({ photos: 4 });
    await rt.dispatch("library.selection.all");
    const ids = rt.store.getState().selection.ids;
    const { value } = (await rt.dispatch<{ maskId: string }>("develop.mask.addDefault", { type: "radial" })) as { value: { maskId: string } };
    for (const id of ids) expect(rt.store.getState().photos.byId[id]!.edit!.masks[0]).toMatchObject({ id: value.maskId, shape: { type: "radial", feather: 50 } });

    await rt.dispatch("develop.mask.update", { maskId: value.maskId, adjustments: { exposure: 1, hsl: { hue: { red: 20 } } } });
    await rt.dispatch("develop.mask.reset", { maskId: value.maskId });
    expect(hasAdjustments(rt.store.getState().photos.byId[ids[0]!]!.edit!.masks[0]!)).toBe(false);

    const dup = (await rt.dispatch<{ maskId: string }>("develop.mask.duplicate", { maskId: value.maskId })) as { value: { maskId: string } };
    expect(dup.value.maskId).not.toBe(value.maskId);
    expect(rt.store.getState().photos.byId[ids[1]!]!.edit!.masks.map((m) => m.id)).toEqual([value.maskId, dup.value.maskId]);

    // Sync copies masks by default, like the other settings.
    await rt.dispatch("library.selection.set", { ids: [ids[0]!], activeId: ids[0]! });
    await rt.dispatch("develop.mask.add", { shape: sky, adjustments: { exposure: -1 } });
    await rt.dispatch("library.selection.set", { ids, activeId: ids[0]! });
    await rt.dispatch("develop.settings.sync");
    expect(rt.store.getState().photos.byId[ids[3]!]!.edit!.masks).toHaveLength(3);
    await rt.dispatch("develop.reset", { groups: ["masks"] });
    expect(rt.store.getState().photos.byId[ids[3]!]!.edit).toBeUndefined();

    for (let i = 0; i < 8; i++) await rt.dispatch("develop.mask.add", { shape: sky });
    const full = await rt.dispatch("develop.mask.add", { shape: sky });
    expect(full).toMatchObject({ ok: false, error: "failed" });
    expect(String((full as { message: string }).message)).toMatch(/at most 8/);
  });

  it("select, overlay and draw are tool state, not edits", async () => {
    const rt = await createTestRuntime({ photos: 2 });
    expect(await rt.dispatch("develop.maskOverlay.toggle")).toMatchObject({ ok: false, error: "unavailable" });
    await rt.dispatch("view.set", { view: "develop" });
    const { value } = (await rt.dispatch<{ maskId: string }>("develop.mask.add", { shape: sky })) as { value: { maskId: string } };
    const before = rt.history.getSnapshot();
    await rt.dispatch("develop.mask.select", { maskId: null });
    expect(rt.store.getState().develop.maskTool.selectedId).toBeNull();
    await rt.dispatch("develop.mask.select", { maskId: value.maskId });
    expect(rt.store.getState().develop.maskTool.selectedId).toBe(value.maskId);
    expect(await rt.dispatch("develop.mask.select", { maskId: "nope" })).toMatchObject({ ok: false });
    await rt.dispatch("develop.maskOverlay.toggle");
    expect(rt.store.getState().develop.maskTool.overlay).toBe(true);
    await rt.dispatch("develop.mask.draw", { shape: "linear" });
    expect(rt.store.getState().develop.maskTool.drawing).toBe("linear");
    await rt.dispatch("develop.mask.draw", { shape: "linear" });
    expect(rt.store.getState().develop.maskTool.drawing).toBeNull();
    expect(rt.history.getSnapshot()).toEqual(before);
  });

  it("export fetches segment masks' bitmaps and fails a photo whose detection fails", async () => {
    const rt = await createTestRuntime({ photos: 2 });
    const id = rt.store.getState().selection.activeId!;
    await rt.dispatch("develop.mask.add", { shape: sky, adjustments: { exposure: -1 } });
    await rt.dispatch("develop.mask.add", { shape: { type: "segment", target: "people" }, adjustments: { exposure: 0.3 } });
    await rt.dispatch("develop.mask.add", { shape: { type: "radial", center: { x: 0.5, y: 0.5 }, radiusX: 0.3, radiusY: 0.3, angle: 0, feather: 50 }, adjustments: { exposure: 0.3 } });
    const ok = await rt.dispatch<{ exported: number }>("develop.export", { destination: "download" });
    expect(ok).toMatchObject({ ok: true, value: { exported: 1 } });
    expect(rt.segmentations.map((s) => s.target).sort()).toEqual(["people", "sky"]);
    const masks = rt.store.getState().photos.byId[id]!.edit!.masks;
    const opts = rt.exports.at(-1)!.opts as { maskBitmaps: Record<string, unknown> };
    expect(Object.keys(opts.maskBitmaps).sort()).toEqual([masks[0]!.id, masks[1]!.id].sort());

    rt.segmentFails.add("people");
    const failed = await rt.dispatch<{ exported: number; failed: Array<{ error: string }> }>("develop.export", { destination: "download" });
    expect(failed).toMatchObject({ ok: true, value: { exported: 0, failed: [{ error: "Can't detect people" }] } });
    await flush();
  });
});
