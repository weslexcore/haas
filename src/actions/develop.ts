import { z } from "zod";
import { defineAction, type AppContext } from "../core/actions/types";
import { all, hasActivePhoto, hasSelection, inView, when } from "../core/actions/when";
import { autoSettings, type AutoPart } from "../core/develop/auto";
import { constrainCrop, cropForAspect, levelAngle } from "../core/develop/crop";
import {
  GROUPS,
  HSL_BANDS,
  SLIDERS,
  SLIDER_NAMES,
  applyPartial,
  curvePoint,
  defaultRecipe,
  groupSchema,
  isDefaultRecipe,
  mergeGroups,
  normalizeCurve,
  partialRecipeSchema,
  type EditRecipe,
  type PartialRecipe,
  type SettingsGroup,
} from "../core/develop/recipe";
import { collectMaskBitmaps } from "../core/develop/mask-bitmaps";
import { baseName } from "../core/library/formats";
import type { AppState, PhotoRecord } from "../core/state/types";
import { targetIds } from "./context";

/** Groups copied/pasted/synced by default (crop is per photo, as in Lightroom). */
const DEFAULT_SYNC_GROUPS: SettingsGroup[] = ["profile", "wb", "basic", "presence", "effects", "toneCurve", "hsl", "masks"];

export const photoIds = z
  .array(z.string())
  .min(1)
  .optional()
  .describe("Photos to change. Omit to use the current selection.");

const groups = z
  .array(groupSchema)
  .min(1)
  .optional()
  .describe(`Settings groups: ${GROUPS.join(", ")}. Defaults to everything except crop.`);

export const editOf = (p: PhotoRecord | undefined): EditRecipe => p?.edit ?? defaultRecipe();

/**
 * Change the recipe of each target photo; unedited recipes are removed entirely.
 * `change` gets the committed (frozen) recipe, not an Immer draft: browsers'
 * structuredClone can't copy a draft's Proxy.
 */
export function updateEdits(ctx: AppContext, ids: string[], change: (recipe: EditRecipe, photo: PhotoRecord) => EditRecipe): void {
  const next = ids.map((id) => {
    const photo = ctx.state.photos.byId[id]!;
    return [id, change(editOf(photo), photo)] as const;
  });
  ctx.update((s: AppState) => {
    for (const [id, recipe] of next) {
      const photo = s.photos.byId[id]!;
      if (isDefaultRecipe(recipe)) delete photo.edit;
      else photo.edit = recipe;
    }
  });
}

const sourceSize = (p: PhotoRecord) => (p.width && p.height ? { width: p.width, height: p.height } : null);

const fmt = (setting: (typeof SLIDER_NAMES)[number], v: number) => {
  const sign = v > 0 ? "+" : "";
  return setting === "exposure" ? `${sign}${v.toFixed(2)}` : `${sign}${Math.round(v)}`;
};

// ── Adjustments ──────────────────────────────────────────────────────────

export const adjust = defineAction({
  id: "develop.adjust",
  title: "Adjust Setting",
  description:
    "Set (value) or nudge (delta) one slider on the selected photos: temperature, tint, exposure " +
    "(stops, -5 to 5), contrast, highlights, shadows, whites, blacks, vibrance, saturation or vignette (-100 to 100; " +
    "negative vignette darkens the corners, positive lightens them). " +
    "Use delta to change each photo relative to its current setting.",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z
    .object({
      setting: z.enum(SLIDER_NAMES as [string, ...string[]]).describe("Which slider."),
      value: z.number().optional().describe("New value (clamped to the slider's range)."),
      delta: z.number().optional().describe("Amount to add to the current value."),
      photoIds,
    })
    .refine((p) => (p.value === undefined) !== (p.delta === undefined), "Give exactly one of value or delta."),
  examples: [
    { params: { setting: "exposure", delta: 0.3 }, description: "Brighten the selection by a third of a stop." },
    { params: { setting: "temperature", value: 25 }, description: "Warm up the white balance." },
    { params: { setting: "contrast", value: 0 }, description: "Reset contrast." },
  ],
  label: (p) => `${SLIDERS[p.setting as keyof typeof SLIDERS].label} ${fmt(p.setting as never, (p.value ?? p.delta)!)}`,
  coalesce: (p) => `develop.adjust:${p.setting}:${p.delta === undefined ? "set" : "delta"}:${p.photoIds?.join("|") ?? ""}`,
  run(p, ctx) {
    const setting = p.setting as (typeof SLIDER_NAMES)[number];
    const range = SLIDERS[setting];
    updateEdits(ctx, targetIds(ctx.state, p.photoIds), (r) => {
      const v = p.value ?? r[setting] + p.delta!;
      return { ...r, [setting]: Math.min(range.max, Math.max(range.min, Math.round(v / range.step) * range.step)) };
    });
  },
});

export const setHsl = defineAction({
  id: "develop.hsl.set",
  title: "Set HSL",
  description:
    "Adjust one colour band's hue, saturation or luminance (-100 to 100) on the selected photos. Bands: red, " +
    "orange, yellow, green, aqua, blue, purple, magenta. E.g. lower blue luminance to darken a sky.",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z.object({
    channel: z.enum(["hue", "saturation", "luminance"]).describe("What to change."),
    band: z.enum(HSL_BANDS).describe("Which colour range."),
    value: z.number().min(-100).max(100).describe("New value, -100 to 100."),
    photoIds,
  }),
  examples: [
    { params: { channel: "luminance", band: "blue", value: -40 }, description: "Darken blue skies." },
    { params: { channel: "saturation", band: "orange", value: -15 }, description: "Calm down skin tones." },
  ],
  label: (p) => `${p.band[0]!.toUpperCase()}${p.band.slice(1)} ${p.channel} ${p.value > 0 ? "+" : ""}${p.value}`,
  coalesce: (p) => `develop.hsl:${p.channel}:${p.band}:${p.photoIds?.join("|") ?? ""}`,
  run(p, ctx) {
    updateEdits(ctx, targetIds(ctx.state, p.photoIds), (r) => {
      const next = structuredClone(r);
      next.hsl[p.channel][p.band] = Math.round(p.value);
      return next;
    });
  },
});

export const setToneCurve = defineAction({
  id: "develop.toneCurve.set",
  title: "Set Tone Curve",
  description:
    "Replace the master tone curve on the selected photos with control points [input, output] in 0–1. " +
    "[[0,0],[1,1]] is neutral; lifting the first point fades blacks, an S-shape adds contrast.",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z.object({
    points: z.array(curvePoint).min(2).max(16).describe("Control points [input, output], 0–1."),
    photoIds,
  }),
  examples: [
    { params: { points: [[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]] }, description: "Gentle S-curve for contrast." },
    { params: { points: [[0, 0.08], [1, 0.95]] }, description: "Faded film look: lifted blacks, softer whites." },
  ],
  coalesce: (p) => `develop.toneCurve:${p.photoIds?.join("|") ?? ""}`,
  run(p, ctx) {
    const points = normalizeCurve(p.points);
    updateEdits(ctx, targetIds(ctx.state, p.photoIds), (r) => ({ ...r, toneCurve: points }));
  },
});

export const applySettings = defineAction({
  id: "develop.settings.apply",
  title: "Apply Develop Settings",
  description:
    "Apply several develop settings at once to the selected photos (a look or preset): any Basic sliders, " +
    "tone curve, HSL bands, crop, masks. Values replace the current ones; omitted settings are unchanged.",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z.object({ settings: partialRecipeSchema, photoIds }),
  examples: [
    {
      params: {
        settings: { temperature: 20, contrast: -10, saturation: -20, toneCurve: [[0, 0.06], [0.5, 0.52], [1, 0.94]] },
      },
      description: "A warm, faded film look.",
    },
    { params: { settings: { saturation: -100 } }, description: "Black and white." },
  ],
  run({ settings, photoIds: ids }, ctx) {
    updateEdits(ctx, targetIds(ctx.state, ids), (r, photo) => {
      const next = applyPartial(r, settings);
      const size = sourceSize(photo);
      if (settings.crop && size) next.crop = constrainCrop(size, next.crop);
      return next;
    });
  },
});

export const getSettings = defineAction({
  id: "develop.settings.get",
  title: "Get Develop Settings",
  description: "Return a photo's full develop settings (the active photo by default), including its masks and their ids, and whether it has been edited.",
  category: "Develop",
  kind: "query",
  params: z.object({ photoId: z.string().optional().describe("Defaults to the active photo.") }).optional(),
  examples: [{ params: {}, description: "Settings of the active photo." }],
  run(p, ctx) {
    const id = p?.photoId ?? ctx.state.selection.activeId;
    const photo = id ? ctx.state.photos.byId[id] : undefined;
    if (!photo) throw new Error(id ? `Unknown photo id ${id}` : "No active photo.");
    return { photoId: photo.id, edited: !!photo.edit, settings: editOf(photo) };
  },
});

export const resetSettings = defineAction({
  id: "develop.reset",
  title: "Reset Develop Settings",
  description: "Reset the selected photos' develop settings to unedited, or only the given groups.",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z.object({ groups: z.array(groupSchema).min(1).optional().describe(`Only these groups (${GROUPS.join(", ")}). Omit for all.`), photoIds }).optional(),
  examples: [
    { params: {}, description: "Reset everything." },
    { params: { groups: ["crop"] }, description: "Remove the crop only." },
  ],
  defaultShortcuts: [{ keys: "mod+shift+r" }],
  run(p, ctx) {
    updateEdits(ctx, targetIds(ctx.state, p?.photoIds), (r) => (p?.groups ? mergeGroups(r, defaultRecipe(), p.groups) : defaultRecipe()));
  },
});

// ── Auto ─────────────────────────────────────────────────────────────────

/** Long edge of the pixels Auto analyses. */
const AUTO_EDGE = 256;
/** Photos analysed at once. */
const AUTO_CONCURRENCY = 4;
const AUTO_LABELS = { tone: "Auto Tone", wb: "Auto White Balance", both: "Auto Tone & White Balance" } as const;
const autoLabel = (include?: readonly AutoPart[]) =>
  !include || (include.length === 1 && include[0] === "tone") ? AUTO_LABELS.tone : include.length === 1 ? AUTO_LABELS.wb : AUTO_LABELS.both;

export const auto = defineAction({
  id: "develop.auto",
  title: "Auto Tone",
  description:
    "Automatically set the selected photos' tone (exposure, contrast, highlights, shadows, whites, blacks, " +
    "vibrance) and/or white balance (temperature, tint) from each photo's own pixels, inside its crop. Each " +
    "photo is analysed separately and the result accounts for its profile and other settings, so apply a " +
    "profile first. Tone replaces those sliders; nothing else changes. One undo step for all photos.",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z
    .object({
      include: z
        .array(z.enum(["tone", "wb"]))
        .min(1)
        .optional()
        .describe("What to set: tone, wb (white balance), or both. Defaults to tone."),
      photoIds,
    })
    .optional(),
  examples: [
    { params: {}, description: "Auto Tone on the selection." },
    { params: { include: ["wb"] }, description: "Auto white balance only." },
    { params: { include: ["wb", "tone"] }, description: "Both, for a batch of photos straight off the card." },
  ],
  defaultShortcuts: [
    { keys: "mod+u" },
    { keys: "mod+shift+u", params: { include: ["wb"] } },
  ],
  label: (p) => autoLabel(p?.include),
  async run(p, ctx) {
    const include = p?.include ?? ["tone"];
    const ids = targetIds(ctx.state, p?.photoIds);
    const settings = new Map<string, PartialRecipe>();
    const failed: Array<{ photoId: string; error: string }> = [];
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++]!;
        const photo = ctx.state.photos.byId[id]!;
        try {
          const pixels = await ctx.services.previews.readPixels(photo, { maxEdge: AUTO_EDGE });
          if (!pixels) throw new Error("Can't decode this photo");
          // Read the recipe now, not before the await, in case it changed meanwhile.
          settings.set(id, autoSettings(pixels, editOf(ctx.state.photos.byId[id]), include));
        } catch (e) {
          failed.push({ photoId: id, error: e instanceof Error ? e.message : String(e) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(AUTO_CONCURRENCY, ids.length) }, worker));
    if (!settings.size) throw new Error(failed[0]?.error ?? "Nothing to adjust.");
    // Skip any photo removed from the library while it was being analysed.
    const done = [...settings.keys()].filter((id) => ctx.state.photos.byId[id]);
    updateEdits(ctx, done, (r, photo) => applyPartial(r, settings.get(photo.id)!));
    return { adjusted: settings.size, failed, settings: Object.fromEntries(settings) };
  },
});

// ── Copy / paste / sync ──────────────────────────────────────────────────

export const copySettings = defineAction({
  id: "develop.settings.copy",
  title: "Copy Settings",
  description: "Copy the active photo's develop settings (by default everything except crop) to paste onto other photos.",
  category: "Develop",
  kind: "command",
  when: hasActivePhoto,
  params: z.object({ groups }).optional(),
  examples: [
    { params: {}, description: "Copy all settings except crop." },
    { params: { groups: ["wb", "toneCurve"] }, description: "Copy only white balance and the curve." },
  ],
  defaultShortcuts: [{ keys: "mod+shift+c" }],
  run(p, ctx) {
    const photo = ctx.state.photos.byId[ctx.state.selection.activeId!];
    ctx.update((s) => {
      s.develop.clipboard = { recipe: editOf(photo), groups: p?.groups ?? DEFAULT_SYNC_GROUPS };
    });
  },
});

export const pasteSettings = defineAction({
  id: "develop.settings.paste",
  title: "Paste Settings",
  description: "Paste copied develop settings onto the selected photos (only the groups that were copied).",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: all(hasSelection, when("develop settings have been copied", (ctx) => ctx.state.develop.clipboard !== null)),
  params: z.object({ photoIds }).optional(),
  examples: [{ params: {}, description: "Paste onto the selection." }],
  defaultShortcuts: [{ keys: "mod+shift+v" }],
  run(p, ctx) {
    const clip = ctx.state.develop.clipboard!;
    updateEdits(ctx, targetIds(ctx.state, p?.photoIds), (r) => mergeGroups(r, clip.recipe, clip.groups));
  },
});

export const syncSettings = defineAction({
  id: "develop.settings.sync",
  title: "Sync Settings",
  description: "Copy the active photo's develop settings to every other selected photo (by default everything except crop).",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: all(hasActivePhoto, when("more than one photo is selected", (ctx) => ctx.state.selection.ids.length > 1)),
  params: z.object({ groups }).optional(),
  examples: [
    { params: {}, description: "Sync everything except crop." },
    { params: { groups: ["wb"] }, description: "Match white balance only." },
  ],
  defaultShortcuts: [{ keys: "mod+shift+s" }],
  targets: (_, ctx) => ctx.state.selection.ids.filter((id) => id !== ctx.state.selection.activeId),
  run(p, ctx) {
    const { activeId, ids } = ctx.state.selection;
    const from = editOf(ctx.state.photos.byId[activeId!]);
    updateEdits(ctx, ids.filter((id) => id !== activeId), (r) => mergeGroups(r, from, p?.groups ?? DEFAULT_SYNC_GROUPS));
  },
});

// ── Crop ─────────────────────────────────────────────────────────────────

const ASPECTS = { original: 0, "1:1": 1, "4:5": 4 / 5, "5:4": 5 / 4, "2:3": 2 / 3, "3:2": 3 / 2, "16:9": 16 / 9, "9:16": 9 / 16 } as const;

export const setCrop = defineAction({
  id: "develop.crop.set",
  title: "Crop & Straighten",
  description:
    "Set the crop rectangle (fractions of the straightened photo: x, y, width, height) and/or straighten angle " +
    "(-45 to 45 degrees) on the selected photos. The crop is kept inside the rotated photo automatically. " +
    "Use aspect to crop to a ratio, as large as fits.",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z.object({
    x: z.number().min(0).max(1).optional().describe("Left edge, 0–1."),
    y: z.number().min(0).max(1).optional().describe("Top edge, 0–1."),
    width: z.number().min(0.01).max(1).optional().describe("Width, 0–1."),
    height: z.number().min(0.01).max(1).optional().describe("Height, 0–1."),
    angle: z.number().min(-45).max(45).optional().describe("Straighten angle in degrees, clockwise."),
    aspect: z.enum(Object.keys(ASPECTS) as [keyof typeof ASPECTS, ...Array<keyof typeof ASPECTS>]).optional().describe("Crop to this aspect ratio (width:height), centred and as large as fits."),
    photoIds,
  }),
  examples: [
    { params: { aspect: "1:1" }, description: "Square crop." },
    { params: { angle: -2.5 }, description: "Straighten a slightly tilted horizon." },
    { params: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, description: "Trim 10% from every edge." },
  ],
  label: (p) => (p.aspect ? `Crop ${p.aspect}` : p.angle !== undefined ? `Straighten ${p.angle}°` : "Crop"),
  coalesce: (p) => `develop.crop:${p.photoIds?.join("|") ?? ""}`,
  run(p, ctx) {
    updateEdits(ctx, targetIds(ctx.state, p.photoIds), (r, photo) => {
      const size = sourceSize(photo) ?? { width: 1, height: 1 };
      const angle = p.angle ?? r.crop.angle;
      if (p.aspect) {
        const aspect = p.aspect === "original" ? size.width / size.height : ASPECTS[p.aspect];
        return { ...r, crop: cropForAspect(size, aspect, angle) };
      }
      const crop = { ...r.crop, angle };
      for (const k of ["x", "y", "width", "height"] as const) if (p[k] !== undefined) crop[k] = p[k]!;
      return { ...r, crop: constrainCrop(size, crop) };
    });
  },
});

const framePoint = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

export const levelCrop = defineAction({
  id: "develop.crop.level",
  title: "Straighten Along Line",
  description:
    "Straighten the active photo so a line along a horizon or vertical edge becomes level (horizontal, or " +
    "vertical when the line is closer to vertical). from/to are fractions (0–1, y down) of the uncropped photo " +
    "as currently straightened; with no straighten angle yet, that is the original photo. The crop is kept " +
    "inside the rotated photo.",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: hasActivePhoto,
  params: z.object({
    from: framePoint.describe("One end of the line."),
    to: framePoint.describe("The other end."),
  }),
  examples: [{ params: { from: { x: 0.1, y: 0.52 }, to: { x: 0.9, y: 0.48 } }, description: "Level a horizon that rises to the right." }],
  label: () => "Straighten",
  run(p, ctx) {
    const id = ctx.state.selection.activeId!;
    updateEdits(ctx, [id], (r, photo) => {
      const size = sourceSize(photo) ?? { width: 1, height: 1 };
      const angle = levelAngle(size, r.crop.angle, p.from, p.to);
      // Already level (or too short to measure): no change, so no undo step.
      return angle === null || angle === r.crop.angle ? r : { ...r, crop: constrainCrop(size, { ...r.crop, angle }) };
    });
  },
});

export const toggleCropTool = defineAction({
  id: "develop.cropTool.toggle",
  title: "Crop Tool",
  description:
    "Show or hide the crop & straighten overlay on the active photo in Loupe or Develop, where the crop can be " +
    "moved, resized and rotated.",
  category: "Develop",
  kind: "command",
  when: all(inView("loupe", "develop"), hasActivePhoto),
  defaultShortcuts: [{ keys: "r" }],
  run(_, ctx) {
    ctx.update((s) => {
      s.develop.cropTool = !s.develop.cropTool;
      s.develop.levelTool = false;
    });
  },
});

export const toggleLevelTool = defineAction({
  id: "develop.levelTool.toggle",
  title: "Straighten Tool",
  description:
    "Arm or disarm the straighten tool in Loupe or Develop: the next drag over the photo draws a line along a horizon " +
    "or vertical edge, and the photo is rotated to make it level. Opens the crop overlay. (In the crop " +
    "overlay, ⌘/Ctrl-drag does the same without arming it.)",
  category: "Develop",
  kind: "command",
  when: all(inView("loupe", "develop"), hasActivePhoto),
  params: z.object({ on: z.boolean().optional().describe("Arm (true) or disarm (false); omit to toggle.") }).optional(),
  examples: [
    { params: {}, description: "Toggle the straighten tool." },
    { params: { on: false }, description: "Disarm it." },
  ],
  run(p, ctx) {
    ctx.update((s) => {
      s.develop.levelTool = p?.on ?? !s.develop.levelTool;
      if (s.develop.levelTool) s.develop.cropTool = true;
    });
  },
});

// ── Export ───────────────────────────────────────────────────────────────

export const exporting = when("an export is running", (ctx) => ctx.state.develop.exportJob !== null);
const notExporting = when("no export is running", (ctx) => !exporting.test(ctx));

export const exportJpeg = defineAction({
  id: "develop.export",
  sideEffects: true,
  title: "Export JPEG",
  description:
    "Render the selected photos (one or many) with their edits at full resolution (or limited to maxEdge pixels " +
    "on the long side) and save them as JPEGs: into the folder's _Exports subfolder when it is writable, " +
    "otherwise as downloads. Photos are written one after another, with progress shown in the status bar; " +
    "develop.export.cancel stops after the current photo. Originals are untouched; existing exports are never " +
    "overwritten. Only one export runs at a time.",
  category: "Develop",
  kind: "command",
  when: all(hasSelection, notExporting),
  params: z
    .object({
      quality: z.number().min(0.3).max(1).optional().describe("JPEG quality, 0.3–1 (default 0.9)."),
      maxEdge: z.number().int().min(64).max(16384).optional().describe("Longest side in pixels; omit for full size."),
      destination: z.enum(["folder", "download"]).optional().describe("folder (_Exports) or download; defaults to folder when writable."),
      photoIds,
    })
    .optional(),
  examples: [
    { params: {}, description: "Export the selection at full size." },
    { params: { maxEdge: 2048, quality: 0.85 }, description: "Smaller copies for sharing." },
  ],
  defaultShortcuts: [{ keys: "mod+shift+e" }],
  async run(p, ctx) {
    const ids = targetIds(ctx.state, p?.photoIds);
    const quality = p?.quality ?? 0.9;
    const folder = ctx.state.library.folder;
    const destination = p?.destination ?? (folder?.writable ? "folder" : "download");
    const source = ctx.services.library.current();
    if (destination === "folder" && (!source || !folder?.writable)) throw new Error("This folder is read-only; export as downloads instead.");

    const files: Array<{ photoId: string; path: string; width: number; height: number }> = [];
    const failed: Array<{ path: string; error: string }> = [];
    let cancelled = false;
    // Decode the next photo while the current one renders: at most two full-size images at a time.
    const decode = (id: string) => ctx.services.previews.decode(ctx.state.photos.byId[id]!).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
    const discard = async (pending: ReturnType<typeof decode> | null) => {
      const image = await pending;
      if (image && !(image instanceof Error)) image.close();
    };

    ctx.update((s) => {
      s.develop.exportJob = { done: 0, total: ids.length, failed: 0, cancelRequested: false };
    });
    let next: ReturnType<typeof decode> | null = ids.length ? decode(ids[0]!) : null;
    try {
      for (let i = 0; i < ids.length; i++) {
        if (ctx.state.develop.exportJob?.cancelRequested) {
          cancelled = true;
          await discard(next);
          break;
        }
        const id = ids[i]!;
        const pending = next!;
        next = i + 1 < ids.length ? decode(ids[i + 1]!) : null;
        try {
          const image = await pending;
          if (image instanceof Error) throw image;
          if (!image) throw new Error("Can't decode this photo");
          // Read the photo now, not before the await: its edit may have changed, or it may be gone.
          const photo = ctx.state.photos.byId[id];
          if (!photo) {
            image.close();
            throw new Error("This photo is no longer in the library");
          }
          let rendered: { blob: Blob; width: number; height: number };
          try {
            const recipe = editOf(photo);
            // Segment masks need their detected areas; a detection that fails fails this photo rather than exporting it wrong.
            const maskBitmaps = await collectMaskBitmaps(ctx.services.segmentation, photo, recipe);
            rendered = await ctx.services.exporter.renderJpeg(image, recipe, {
              quality,
              ...(p?.maxEdge ? { maxEdge: p.maxEdge } : {}),
              ...(Object.keys(maskBitmaps).length ? { maskBitmaps } : {}),
            });
          } finally {
            image.close();
          }
          const name = `${baseName(photo.id)}.jpg`;
          let path = name;
          if (destination === "folder") path = await source!.writeExport(name, rendered.blob);
          else ctx.services.downloads.saveBlob(name, rendered.blob);
          files.push({ photoId: id, path, width: rendered.width, height: rendered.height });
        } catch (e) {
          failed.push({ path: id, error: e instanceof Error ? e.message : String(e) });
        }
        ctx.update((s) => {
          if (!s.develop.exportJob) return;
          s.develop.exportJob.done = i + 1;
          s.develop.exportJob.failed = failed.length;
        });
      }
    } finally {
      ctx.update((s) => {
        s.develop.exportJob = null;
      });
    }
    return { exported: files.length, total: ids.length, destination, files, failed, cancelled };
  },
});

export const cancelExport = defineAction({
  id: "develop.export.cancel",
  title: "Cancel Export",
  description:
    "Stop the export that is running, once the photo being written has finished. Photos exported so far are kept; " +
    "the rest are skipped.",
  category: "Develop",
  kind: "command",
  when: exporting,
  run(_, ctx) {
    ctx.update((s) => {
      if (s.develop.exportJob) s.develop.exportJob.cancelRequested = true;
    });
  },
});

export const developActions = [
  adjust,
  setHsl,
  setToneCurve,
  applySettings,
  getSettings,
  resetSettings,
  auto,
  copySettings,
  pasteSettings,
  syncSettings,
  setCrop,
  levelCrop,
  toggleLevelTool,
  toggleCropTool,
  exportJpeg,
  cancelExport,
];
