import { z } from "zod";
import { defineAction } from "../core/actions/types";
import { all, hasActivePhoto, hasSelection, inView, when } from "../core/actions/when";
import { defaultShape, hasAdjustments, maskLabel, newMaskId } from "../core/develop/masks";
import {
  MASK_SLIDER_NAMES,
  MAX_MASKS,
  SEGMENT_TARGETS,
  SLIDERS,
  applyPartialAdjustments,
  defaultMaskAdjustments,
  maskAdjustmentsSchema,
  maskShapeSchema,
  partialMaskAdjustmentsSchema,
  type Mask,
  type MaskShape,
  type PartialMaskAdjustments,
} from "../core/develop/recipe";
import { targetIds } from "./context";
import { editOf, photoIds, updateEdits } from "./develop";

/**
 * Masks: local adjustments over part of a photo. A mask has a shape (gradient,
 * luminance or colour range, or a detected area such as the sky) and its own
 * Basic sliders, tone curve and HSL, added to the photo's settings inside it.
 * Masks live in the recipe, so they copy, sync, reset and save like any other
 * setting, and travel in the XMP sidecar.
 */

const maskId = z.string().min(1).describe("The mask's id (from develop.mask.add or develop.settings.get).");

const hasMasks = when("the active photo has masks", (ctx) => {
  const id = ctx.state.selection.activeId;
  return !!id && (ctx.state.photos.byId[id]?.edit?.masks?.length ?? 0) > 0;
});

const findMask = (recipe: { masks: Mask[] }, id: string): Mask => {
  const mask = recipe.masks.find((m) => m.id === id);
  if (!mask) throw new Error(`No mask ${id} on this photo.`);
  return mask;
};

const fmt = (name: (typeof MASK_SLIDER_NAMES)[number], v: number) => {
  const sign = v > 0 ? "+" : "";
  return name === "exposure" ? `${sign}${v.toFixed(2)}` : `${sign}${Math.round(v)}`;
};

/** A short label for what an update changes, for the palette and history. */
function updateLabel(p: { adjustments?: PartialMaskAdjustments; shape?: MaskShape; name?: string; enabled?: boolean; invert?: boolean }): string {
  const a = p.adjustments;
  if (a) {
    const slider = MASK_SLIDER_NAMES.find((n) => a[n] !== undefined);
    if (slider) return `Mask: ${SLIDERS[slider].label} ${fmt(slider, a[slider]!)}`;
    if (a.toneCurve) return "Mask: Tone Curve";
    if (a.hsl) return "Mask: HSL";
  }
  if (p.shape) return "Mask: Shape";
  if (p.name !== undefined) return "Rename Mask";
  if (p.enabled !== undefined) return p.enabled ? "Enable Mask" : "Disable Mask";
  if (p.invert !== undefined) return p.invert ? "Invert Mask" : "Un-invert Mask";
  return "Edit Mask";
}

export const addMask = defineAction({
  id: "develop.mask.add",
  title: "Add Mask",
  description:
    "Add a mask to the selected photos: an area with its own adjustments on top of the photo's settings. Shapes: " +
    "linear gradient (from/to points), radial gradient (centre, radii, angle, feather), luminance range (low–high " +
    "brightness of the original photo), colour range (a hue), or segment (sky, subject, background, people, " +
    "vegetation or water, detected by an in-browser model). Points and radii are fractions of the photo's width and " +
    "height, placed on the uncropped photo. Give the adjustments now or change them later with develop.mask.update " +
    `(sliders add to the photo's: exposure -1 inside the mask darkens it by a stop). Up to ${MAX_MASKS} masks per ` +
    "photo. Returns the new mask's id (the same id on every photo), and selects it in the Develop panel.",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z.object({
    shape: maskShapeSchema,
    adjustments: partialMaskAdjustmentsSchema.optional(),
    name: z.string().max(60).optional().describe("A name for the panel; defaults to one from the shape."),
    invert: z.boolean().optional().describe("Apply outside the area instead of inside."),
    photoIds,
  }),
  examples: [
    { params: { shape: { type: "segment", target: "sky" }, adjustments: { exposure: -0.7, highlights: -40, saturation: 15 } }, description: "Darken and deepen the sky." },
    { params: { shape: { type: "segment", target: "subject" }, adjustments: { exposure: 0.4, shadows: 30 } }, description: "Lift the subject." },
    { params: { shape: { type: "linear", from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 0.5 } }, adjustments: { exposure: -1 } }, description: "A graduated filter darkening the top half." },
    { params: { shape: { type: "radial", center: { x: 0.5, y: 0.45 }, radiusX: 0.3, radiusY: 0.4, angle: 0, feather: 60 }, invert: true, adjustments: { exposure: -0.6 } }, description: "Darken everything around the centre (a custom vignette)." },
    { params: { shape: { type: "luminance", low: 0, high: 30, feather: 15 }, adjustments: { shadows: 40, temperature: 10 } }, description: "Lift and warm the shadows only." },
    { params: { shape: { type: "color", hue: 210, range: 50, feather: 50 }, adjustments: { saturation: -40 } }, description: "Mute the blues." },
  ],
  label: (p) => `Add ${maskLabel({ name: p.name ?? "", shape: p.shape })} Mask`,
  run(p, ctx) {
    const ids = targetIds(ctx.state, p.photoIds);
    const existing = ids.flatMap((id) => editOf(ctx.state.photos.byId[id]).masks);
    const full = ids.filter((id) => editOf(ctx.state.photos.byId[id]).masks.length >= MAX_MASKS);
    if (full.length) throw new Error(`A photo can have at most ${MAX_MASKS} masks (${full[0]} is full).`);
    const id = newMaskId(existing);
    const adjustments = p.adjustments ? applyPartialAdjustments(defaultMaskAdjustments(), p.adjustments) : defaultMaskAdjustments();
    const mask: Mask = { id, name: p.name ?? "", enabled: true, invert: p.invert ?? false, shape: p.shape, adjustments };
    updateEdits(ctx, ids, (r) => ({ ...r, masks: [...r.masks, structuredClone(mask)] }));
    ctx.update((s) => {
      s.develop.maskTool.selectedId = id;
      s.develop.maskTool.drawing = null;
    });
    return { maskId: id };
  },
});

export const updateMask = defineAction({
  id: "develop.mask.update",
  title: "Edit Mask",
  description:
    "Change a mask on the selected photos: its adjustments (sliders, tone curve, HSL; only the given ones change), " +
    "its shape (replaced whole, same or different type), name, enabled, or invert. Adjustments are offsets added " +
    "to the photo's settings inside the mask; 0 is no change.",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z.object({
    maskId,
    adjustments: partialMaskAdjustmentsSchema.optional(),
    shape: maskShapeSchema.optional(),
    name: z.string().max(60).optional().describe("A new name."),
    enabled: z.boolean().optional().describe("Turn the mask off (false) or on without removing it."),
    invert: z.boolean().optional().describe("Apply outside the area (true) or inside (false)."),
    photoIds,
  }),
  examples: [
    { params: { maskId: "m1a2b3c", adjustments: { exposure: -1.2, contrast: 20 } }, description: "Stronger darkening inside the mask." },
    { params: { maskId: "m1a2b3c", shape: { type: "radial", center: { x: 0.6, y: 0.4 }, radiusX: 0.25, radiusY: 0.3, angle: 0, feather: 70 } }, description: "Move and soften a radial mask." },
    { params: { maskId: "m1a2b3c", enabled: false }, description: "Switch a mask off to compare." },
  ],
  label: updateLabel,
  coalesce: (p) => `develop.mask.update:${p.maskId}:${Object.keys(p.adjustments ?? {}).join(",")}:${p.shape ? "shape" : ""}:${p.photoIds?.join("|") ?? ""}`,
  run(p, ctx) {
    const ids = targetIds(ctx.state, p.photoIds);
    for (const id of ids) findMask(editOf(ctx.state.photos.byId[id]), p.maskId);
    updateEdits(ctx, ids, (r) => ({
      ...r,
      masks: r.masks.map((m) => {
        if (m.id !== p.maskId) return m;
        return {
          ...m,
          name: p.name ?? m.name,
          enabled: p.enabled ?? m.enabled,
          invert: p.invert ?? m.invert,
          shape: p.shape ? structuredClone(p.shape) : m.shape,
          adjustments: p.adjustments ? applyPartialAdjustments(m.adjustments, p.adjustments) : m.adjustments,
        };
      }),
    }));
  },
});

export const removeMask = defineAction({
  id: "develop.mask.remove",
  title: "Remove Mask",
  description: "Remove a mask from the selected photos (undoable). To reset a mask's adjustments but keep its shape, use develop.mask.reset.",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z.object({ maskId, photoIds }),
  examples: [{ params: { maskId: "m1a2b3c" }, description: "Remove the mask." }],
  run(p, ctx) {
    const ids = targetIds(ctx.state, p.photoIds);
    for (const id of ids) findMask(editOf(ctx.state.photos.byId[id]), p.maskId);
    updateEdits(ctx, ids, (r) => ({ ...r, masks: r.masks.filter((m) => m.id !== p.maskId) }));
    ctx.update((s) => {
      if (s.develop.maskTool.selectedId === p.maskId) s.develop.maskTool.selectedId = null;
    });
  },
});

export const resetMask = defineAction({
  id: "develop.mask.reset",
  title: "Reset Mask Adjustments",
  description: "Set a mask's adjustments back to nothing (its shape stays) on the selected photos.",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z.object({ maskId, photoIds }),
  examples: [{ params: { maskId: "m1a2b3c" }, description: "Clear the mask's adjustments." }],
  run(p, ctx) {
    const ids = targetIds(ctx.state, p.photoIds);
    for (const id of ids) findMask(editOf(ctx.state.photos.byId[id]), p.maskId);
    updateEdits(ctx, ids, (r) => ({
      ...r,
      masks: r.masks.map((m) => (m.id === p.maskId && hasAdjustments(m) ? { ...m, adjustments: maskAdjustmentsSchema.parse({}) } : m)),
    }));
  },
});

export const duplicateMask = defineAction({
  id: "develop.mask.duplicate",
  title: "Duplicate Mask",
  description: "Copy a mask (shape and adjustments) on the selected photos, as a new mask with its own id. Returns the new id.",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z.object({ maskId, photoIds }),
  examples: [{ params: { maskId: "m1a2b3c" }, description: "Duplicate the mask, then move or invert the copy." }],
  run(p, ctx) {
    const ids = targetIds(ctx.state, p.photoIds);
    for (const id of ids) findMask(editOf(ctx.state.photos.byId[id]), p.maskId);
    const full = ids.filter((id) => editOf(ctx.state.photos.byId[id]).masks.length >= MAX_MASKS);
    if (full.length) throw new Error(`A photo can have at most ${MAX_MASKS} masks (${full[0]} is full).`);
    const newId = newMaskId(ids.flatMap((id) => editOf(ctx.state.photos.byId[id]).masks));
    updateEdits(ctx, ids, (r) => {
      const source = findMask(r, p.maskId);
      const copy = structuredClone(source);
      copy.id = newId;
      copy.name = source.name ? `${source.name} copy` : "";
      return { ...r, masks: [...r.masks, copy] };
    });
    ctx.update((s) => {
      s.develop.maskTool.selectedId = newId;
    });
    return { maskId: newId };
  },
});

export const selectMask = defineAction({
  id: "develop.mask.select",
  title: "Select Mask",
  description:
    "Choose which of the active photo's masks the Develop panel edits and the photo shows handles for (null: none). " +
    "Not undoable.",
  category: "Develop",
  kind: "command",
  when: hasActivePhoto,
  params: z.object({ maskId: maskId.nullable().describe("The mask to edit, or null for none.") }),
  examples: [
    { params: { maskId: "m1a2b3c" }, description: "Edit this mask." },
    { params: { maskId: null }, description: "Leave mask editing." },
  ],
  run(p, ctx) {
    if (p.maskId !== null) findMask(editOf(ctx.state.photos.byId[ctx.state.selection.activeId!]), p.maskId);
    ctx.update((s) => {
      s.develop.maskTool.selectedId = p.maskId;
      s.develop.maskTool.drawing = null;
    });
  },
});

export const toggleMaskOverlay = defineAction({
  id: "develop.maskOverlay.toggle",
  title: "Show Mask Overlay",
  description: "Show or hide the selected mask's coverage painted in red over the photo, in Loupe or Develop.",
  category: "Develop",
  kind: "command",
  when: all(inView("loupe", "develop"), hasMasks),
  params: z.object({ on: z.boolean().optional().describe("Show (true) or hide (false); omit to toggle.") }).optional(),
  examples: [
    { params: {}, description: "Toggle the red overlay." },
    { params: { on: true }, description: "Show it." },
  ],
  defaultShortcuts: [{ keys: "o" }],
  run(p, ctx) {
    ctx.update((s) => {
      s.develop.maskTool.overlay = p?.on ?? !s.develop.maskTool.overlay;
    });
  },
});

export const drawMask = defineAction({
  id: "develop.mask.draw",
  title: "Draw Mask",
  description:
    "Arm the mask tool in Loupe or Develop so the next drag over the photo draws a new linear or radial gradient " +
    "mask (a drag from where it is fully on to where it fades out, or from the centre of the ellipse to its edge). " +
    "Dispatching the same shape again, or null, disarms it.",
  category: "Develop",
  kind: "command",
  when: all(inView("loupe", "develop"), hasActivePhoto),
  params: z.object({ shape: z.enum(["linear", "radial"]).nullable().describe("Which gradient to draw, or null to disarm.") }),
  examples: [
    { params: { shape: "linear" }, description: "Draw a graduated filter." },
    { params: { shape: null }, description: "Disarm." },
  ],
  label: (p) => (p.shape ? `Draw ${p.shape === "linear" ? "Linear" : "Radial"} Gradient` : "Stop Drawing Mask"),
  run(p, ctx) {
    ctx.update((s) => {
      s.develop.maskTool.drawing = s.develop.maskTool.drawing === p.shape ? null : p.shape;
    });
  },
});

/** Add a mask with the default geometry for its type, for menus and the panel's quick buttons. */
export const addDefaultMask = defineAction({
  id: "develop.mask.addDefault",
  title: "Add Default Mask",
  description:
    "Add a mask with a standard shape to the selected photos: a linear gradient over the top, a radial gradient in " +
    "the middle, a shadows luminance range, a blue colour range, or a segment of the given target. Then adjust it " +
    "with develop.mask.update. Returns the mask id.",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z.object({
    type: z.enum(["linear", "radial", "luminance", "color", "segment"]).describe("The shape type."),
    target: z.enum(SEGMENT_TARGETS).optional().describe("For segment masks: what to detect (default subject)."),
    photoIds,
  }),
  examples: [
    { params: { type: "segment", target: "sky" }, description: "A sky mask, ready for adjustments." },
    { params: { type: "radial" }, description: "An ellipse in the middle of the photo." },
  ],
  label: (p) => `Add ${maskLabel({ name: "", shape: defaultShape(p.type, p.target) })} Mask`,
  async run(p, ctx) {
    const r = await ctx.dispatch<{ maskId: string }>("develop.mask.add", { shape: defaultShape(p.type, p.target), ...(p.photoIds ? { photoIds: p.photoIds } : {}) });
    if (!r.ok) throw new Error(r.message);
    return r.value;
  },
});

export const maskActions = [addMask, addDefaultMask, updateMask, removeMask, resetMask, duplicateMask, selectMask, toggleMaskOverlay, drawMask];
