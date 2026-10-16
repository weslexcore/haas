import { z } from "zod";

/**
 * The non-destructive edit recipe for one photo. Every value has a neutral
 * default; a photo with no `edit` (or a default one) renders unchanged.
 */

export const HSL_BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
export type HslBand = (typeof HSL_BANDS)[number];

/** Basic-panel sliders: name → range and neutral value. */
export const SLIDERS = {
  temperature: { min: -100, max: 100, step: 1, label: "Temperature", group: "wb" },
  tint: { min: -100, max: 100, step: 1, label: "Tint", group: "wb" },
  exposure: { min: -5, max: 5, step: 0.01, label: "Exposure", group: "basic" },
  contrast: { min: -100, max: 100, step: 1, label: "Contrast", group: "basic" },
  highlights: { min: -100, max: 100, step: 1, label: "Highlights", group: "basic" },
  shadows: { min: -100, max: 100, step: 1, label: "Shadows", group: "basic" },
  whites: { min: -100, max: 100, step: 1, label: "Whites", group: "basic" },
  blacks: { min: -100, max: 100, step: 1, label: "Blacks", group: "basic" },
  vibrance: { min: -100, max: 100, step: 1, label: "Vibrance", group: "presence" },
  saturation: { min: -100, max: 100, step: 1, label: "Saturation", group: "presence" },
} as const;

export type SliderName = keyof typeof SLIDERS;
export const SLIDER_NAMES = Object.keys(SLIDERS) as SliderName[];

const slider = (name: SliderName) =>
  z.number().min(SLIDERS[name].min).max(SLIDERS[name].max).describe(`${SLIDERS[name].label}, ${SLIDERS[name].min} to ${SLIDERS[name].max}.`);

const band = z.number().min(-100).max(100);
const bands = z.object(Object.fromEntries(HSL_BANDS.map((b) => [b, band])) as Record<HslBand, typeof band>);

export const curvePoint = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

export const cropSchema = z.object({
  /** Crop rectangle in the straightened image, as fractions of its width/height. */
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.01).max(1),
  height: z.number().min(0.01).max(1),
  /** Straighten angle in degrees, clockwise. */
  angle: z.number().min(-45).max(45),
});

export const recipeSchema = z.object({
  version: z.literal(1),
  ...(Object.fromEntries(SLIDER_NAMES.map((n) => [n, slider(n)])) as Record<SliderName, z.ZodNumber>),
  /** Master RGB tone curve: control points (input, output) in 0–1, sorted by input, first x=0 and last x=1. */
  toneCurve: z.array(curvePoint).min(2).max(16),
  hsl: z.object({ hue: bands, saturation: bands, luminance: bands }),
  crop: cropSchema,
});

export type EditRecipe = z.infer<typeof recipeSchema>;
export type CropRect = z.infer<typeof cropSchema>;

const zeroBands = () => Object.fromEntries(HSL_BANDS.map((b) => [b, 0])) as Record<HslBand, number>;

export const DEFAULT_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1, angle: 0 };

export function defaultRecipe(): EditRecipe {
  return {
    version: 1,
    ...(Object.fromEntries(SLIDER_NAMES.map((n) => [n, 0])) as Record<SliderName, number>),
    toneCurve: [
      [0, 0],
      [1, 1],
    ],
    hsl: { hue: zeroBands(), saturation: zeroBands(), luminance: zeroBands() },
    crop: { ...DEFAULT_CROP },
  };
}

/** Settings groups, for reset/copy/paste/sync of only some settings. */
export const GROUPS = ["wb", "basic", "presence", "toneCurve", "hsl", "crop"] as const;
export type SettingsGroup = (typeof GROUPS)[number];
export const groupSchema = z.enum(GROUPS);

/** Keys of the recipe that belong to each group. */
export function groupKeys(group: SettingsGroup): Array<keyof EditRecipe> {
  if (group === "toneCurve" || group === "hsl" || group === "crop") return [group];
  return SLIDER_NAMES.filter((n) => SLIDERS[n].group === group);
}

/** Copy the given groups from `from` onto `to` (immutably). */
export function mergeGroups(to: EditRecipe, from: EditRecipe, groups: readonly SettingsGroup[]): EditRecipe {
  const out = structuredClone(to);
  for (const g of groups) for (const k of groupKeys(g)) (out as Record<string, unknown>)[k] = structuredClone(from[k]);
  return out;
}

export function isDefaultRecipe(r: EditRecipe | undefined): boolean {
  return !r || JSON.stringify(r) === JSON.stringify(defaultRecipe());
}

export const isCropped = (c: CropRect) => c.x !== 0 || c.y !== 0 || c.width !== 1 || c.height !== 1 || c.angle !== 0;

/**
 * Deep-partial settings, as accepted by develop.settings.apply. Every field is
 * optional; given HSL bands replace just those bands.
 */
const partialBands = bands.partial();
export const partialRecipeSchema = z
  .object({
    ...(Object.fromEntries(SLIDER_NAMES.map((n) => [n, slider(n).optional()])) as Record<SliderName, z.ZodOptional<z.ZodNumber>>),
    toneCurve: z.array(curvePoint).min(2).max(16).optional().describe("Tone curve control points [input, output], 0–1."),
    hsl: z
      .object({ hue: partialBands.optional(), saturation: partialBands.optional(), luminance: partialBands.optional() })
      .optional()
      .describe("Per-colour adjustments, -100 to 100, by band (red, orange, yellow, green, aqua, blue, purple, magenta)."),
    crop: cropSchema.partial().optional().describe("Crop rectangle (fractions) and straighten angle (degrees)."),
  })
  .describe("Settings to change; anything omitted is left as it is.");

export type PartialRecipe = z.infer<typeof partialRecipeSchema>;

export function applyPartial(base: EditRecipe, p: PartialRecipe): EditRecipe {
  const out = structuredClone(base);
  for (const n of SLIDER_NAMES) if (p[n] !== undefined) out[n] = p[n]!;
  if (p.toneCurve) out.toneCurve = normalizeCurve(p.toneCurve);
  if (p.hsl) {
    for (const ch of ["hue", "saturation", "luminance"] as const) Object.assign(out.hsl[ch], p.hsl[ch] ?? {});
  }
  if (p.crop) out.crop = { ...out.crop, ...p.crop };
  return out;
}

/** Sort points by input, keep the ends at x=0 and x=1, and drop duplicate inputs. */
export function normalizeCurve(points: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const sorted = [...points].map(([x, y]) => [clamp01(x), clamp01(y)] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const p of sorted) if (!out.length || p[0] - out.at(-1)![0] > 1e-4) out.push(p);
  if (out[0]![0] !== 0) out.unshift([0, out[0]![1] === undefined ? 0 : Math.min(out[0]![1], 0)]);
  if (out.at(-1)![0] !== 1) out.push([1, Math.max(out.at(-1)![1], 1)]);
  return out;
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
