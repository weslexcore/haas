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
  /** Post-crop vignette: negative darkens the corners, positive fades them to white. */
  vignette: { min: -100, max: 100, step: 1, label: "Vignette", group: "effects" },
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

const IDENTITY_CURVE: Array<[number, number]> = [
  [0, 0],
  [1, 1],
];
const channelCurve = z.array(curvePoint).min(2).max(16).default(IDENTITY_CURVE);

/**
 * A profile's look: the base rendering applied under the sliders (see
 * pipeline.ts). Every field has a neutral default, so a partial look (or one
 * saved before a field existed) parses.
 */
export const lookSchema = z.object({
  /** Per-channel curves, control points (input, output) in 0–1. */
  curves: z
    .object({ red: channelCurve, green: channelCurve, blue: channelCurve })
    .default({ red: IDENTITY_CURVE, green: IDENTITY_CURVE, blue: IDENTITY_CURVE })
    .describe("Red, green and blue curves: control points [input, output] in 0–1."),
  /** Black and white: channel mix in percent (null for colour). */
  monochrome: z
    .object({ red: z.number().min(-200).max(200), green: z.number().min(-200).max(200), blue: z.number().min(-200).max(200) })
    .nullable()
    .default(null)
    .describe("Black and white channel mix in percent (e.g. 30/59/11 neutral, high red darkens skies); null for colour."),
  saturation: z.number().min(-100).max(100).default(0).describe("Overall saturation of the look, -100 to 100."),
  fade: z.number().min(0).max(100).default(0).describe("Lifts the blacks for a faded print, 0 to 100."),
  splitToning: z
    .object({
      shadowHue: z.number().min(0).max(360).default(0),
      shadowSaturation: z.number().min(0).max(100).default(0),
      highlightHue: z.number().min(0).max(360).default(0),
      highlightSaturation: z.number().min(0).max(100).default(0),
      balance: z.number().min(-100).max(100).default(0),
    })
    .default({ shadowHue: 0, shadowSaturation: 0, highlightHue: 0, highlightSaturation: 0, balance: 0 })
    .describe("Tints shadows and highlights: hues in degrees, saturation 0 to 100, balance -100 (shadows) to 100 (highlights)."),
  grain: z
    .object({ amount: z.number().min(0).max(100).default(0), size: z.number().min(0).max(100).default(25) })
    .default({ amount: 0, size: 25 })
    .describe("Film grain: amount 0 to 100, size 0 (fine) to 100 (coarse)."),
});

export type Look = z.infer<typeof lookSchema>;

export function neutralLook(): Look {
  return lookSchema.parse({});
}

/**
 * The profile applied to a photo. The look is a copy of the profile's, so a
 * recipe renders the same anywhere (another browser, an XMP sidecar read
 * elsewhere) even if that profile isn't installed there.
 */
export const recipeProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** Strength in percent; 100 is the profile as designed. */
  amount: z.number().min(0).max(200),
  look: lookSchema,
});

export type RecipeProfile = z.infer<typeof recipeProfileSchema>;

// ── Masks ────────────────────────────────────────────────────────────────

/** Sliders a mask can adjust locally: every Basic slider (the vignette is whole-frame). */
export type MaskSliderName = Exclude<SliderName, "vignette">;
export const MASK_SLIDER_NAMES = SLIDER_NAMES.filter((n): n is MaskSliderName => n !== "vignette");

/** At most this many masks per photo (the shader has room for exactly this many). */
export const MAX_MASKS = 8;

/** What a segment mask detects in the photo (an in-browser scene segmentation model). */
export const SEGMENT_TARGETS = ["subject", "sky", "background", "people", "vegetation", "water"] as const;
export type SegmentTarget = (typeof SEGMENT_TARGETS)[number];

/**
 * A point on the photo as fractions of its width and height (0–1 inside;
 * slightly outside is allowed so a gradient can start off the edge). Masks
 * are placed on the source photo, so they stay on the same pixels whatever
 * the crop and straighten angle.
 */
const uv = z.number().min(-1).max(2);
const maskPoint = z.object({ x: uv, y: uv });
export type MaskPoint = z.infer<typeof maskPoint>;

export const maskShapeSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("linear"),
        from: maskPoint.describe("Where the mask is fully on."),
        to: maskPoint.describe("Where it has faded to nothing. Before `from` it is fully on, past `to` it is off."),
      })
      .describe("Linear gradient: full strength at `from`, fading to nothing at `to`."),
    z
      .object({
        type: z.literal("radial"),
        center: maskPoint.describe("Centre of the ellipse."),
        radiusX: z.number().min(0.005).max(2).describe("Horizontal radius, as a fraction of the photo's width."),
        radiusY: z.number().min(0.005).max(2).describe("Vertical radius, as a fraction of the photo's height."),
        angle: z.number().min(-180).max(180).default(0).describe("Rotation of the ellipse in degrees, clockwise."),
        feather: z.number().min(0).max(100).default(50).describe("Softness of the edge: 0 hard, 100 fades from the centre."),
      })
      .describe("Radial gradient: full strength inside an ellipse, feathered at its edge."),
    z
      .object({
        type: z.literal("luminance"),
        low: z.number().min(0).max(100).default(0).describe("Darkest luminance included, 0–100."),
        high: z.number().min(0).max(100).default(100).describe("Brightest luminance included, 0–100."),
        feather: z.number().min(0).max(100).default(20).describe("How far beyond the range the mask fades out, in luminance units."),
      })
      .describe("Luminance range: pixels of the original photo whose brightness is between low and high."),
    z
      .object({
        type: z.literal("color"),
        hue: z.number().min(0).max(360).describe("Hue to select, in degrees (0 red, 60 yellow, 120 green, 210 sky blue, 300 magenta)."),
        range: z.number().min(5).max(180).default(40).describe("Width of the hue range in degrees."),
        feather: z.number().min(0).max(100).default(50).describe("Softness beyond the range (100 = 90 degrees)."),
      })
      .describe("Colour range: pixels of the original photo close to a hue (greys are never selected)."),
    z
      .object({
        type: z.literal("segment"),
        target: z.enum(SEGMENT_TARGETS).describe("What to detect: subject (people, animals, vehicles), sky, background (everything but the subject), people, vegetation or water."),
      })
      .describe("Detected by a scene segmentation model running in the browser (downloaded on first use)."),
  ])
  .describe("The area a mask covers.");

export type MaskShape = z.infer<typeof maskShapeSchema>;
export type MaskShapeType = MaskShape["type"];

const maskSlider = (name: MaskSliderName) => slider(name).default(0);

/** What a mask changes inside its area, on top of the photo's own settings. */
export const maskAdjustmentsSchema = z
  .object({
    ...(Object.fromEntries(MASK_SLIDER_NAMES.map((n) => [n, maskSlider(n)])) as Record<MaskSliderName, z.ZodDefault<z.ZodNumber>>),
    toneCurve: channelCurve.describe("Tone curve applied inside the mask, as an offset from the identity; [[0,0],[1,1]] is none."),
    hsl: z
      .object({ hue: bands, saturation: bands, luminance: bands })
      .default(() => ({ hue: zeroBands(), saturation: zeroBands(), luminance: zeroBands() }))
      .describe("Per-colour adjustments inside the mask, -100 to 100 by band."),
  })
  .describe("Adjustments applied inside the mask, added to the photo's settings there.");

export type MaskAdjustments = z.infer<typeof maskAdjustmentsSchema>;

export function defaultMaskAdjustments(): MaskAdjustments {
  return maskAdjustmentsSchema.parse({});
}

export const maskSchema = z.object({
  id: z.string().min(1).max(32).describe("Unique within the photo."),
  name: z.string().max(60).default("").describe("Shown in the panel; empty for a name from the shape."),
  enabled: z.boolean().default(true),
  invert: z.boolean().default(false).describe("Apply the adjustments everywhere except the area."),
  shape: maskShapeSchema,
  adjustments: maskAdjustmentsSchema.default(defaultMaskAdjustments),
});

export type Mask = z.infer<typeof maskSchema>;

export const recipeSchema = z.object({
  version: z.literal(1),
  // Sliders default to neutral so recipes saved before a slider existed still parse.
  ...(Object.fromEntries(SLIDER_NAMES.map((n) => [n, slider(n).default(0)])) as Record<SliderName, z.ZodDefault<z.ZodNumber>>),
  /** Master RGB tone curve: control points (input, output) in 0–1, sorted by input, first x=0 and last x=1. */
  toneCurve: z.array(curvePoint).min(2).max(16),
  hsl: z.object({ hue: bands, saturation: bands, luminance: bands }),
  crop: cropSchema,
  /** Absent: no profile. */
  profile: recipeProfileSchema.optional(),
  /** Local adjustments, applied in order on top of the global settings. Recipes saved before masks existed have none. */
  masks: z.array(maskSchema).max(MAX_MASKS).default(() => []),
});

export type EditRecipe = z.infer<typeof recipeSchema>;
export type CropRect = z.infer<typeof cropSchema>;

function zeroBands() {
  return Object.fromEntries(HSL_BANDS.map((b) => [b, 0])) as Record<HslBand, number>;
}

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
    masks: [],
  };
}

/** Settings groups, for reset/copy/paste/sync of only some settings. */
export const GROUPS = ["profile", "wb", "basic", "presence", "effects", "toneCurve", "hsl", "crop", "masks"] as const;
export type SettingsGroup = (typeof GROUPS)[number];
export const groupSchema = z.enum(GROUPS);

/** Keys of the recipe that belong to each group. */
export function groupKeys(group: SettingsGroup): Array<keyof EditRecipe> {
  if (group === "profile" || group === "toneCurve" || group === "hsl" || group === "crop" || group === "masks") return [group];
  return SLIDER_NAMES.filter((n) => SLIDERS[n].group === group);
}

/** Copy the given groups from `from` onto `to` (immutably). */
export function mergeGroups(to: EditRecipe, from: EditRecipe, groups: readonly SettingsGroup[]): EditRecipe {
  const out = structuredClone(to) as Record<string, unknown>;
  for (const g of groups) {
    for (const k of groupKeys(g)) {
      if (from[k] === undefined) delete out[k];
      else out[k] = structuredClone(from[k]);
    }
  }
  return out as EditRecipe;
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
    masks: z.array(maskSchema).max(MAX_MASKS).optional().describe("Replaces every mask (use the develop.mask.* actions to change one)."),
  })
  .describe("Settings to change; anything omitted is left as it is.");

export type PartialRecipe = z.infer<typeof partialRecipeSchema>;

/** Deep-partial mask adjustments, as accepted by develop.mask.update. */
export const partialMaskAdjustmentsSchema = z
  .object({
    ...(Object.fromEntries(MASK_SLIDER_NAMES.map((n) => [n, slider(n).optional()])) as Record<MaskSliderName, z.ZodOptional<z.ZodNumber>>),
    toneCurve: z.array(curvePoint).min(2).max(16).optional().describe("Tone curve control points [input, output], 0–1; [[0,0],[1,1]] is none."),
    hsl: z
      .object({ hue: partialBands.optional(), saturation: partialBands.optional(), luminance: partialBands.optional() })
      .optional()
      .describe("Per-colour adjustments, -100 to 100, by band."),
  })
  .describe("Adjustments to change inside the mask; anything omitted is left as it is.");

export type PartialMaskAdjustments = z.infer<typeof partialMaskAdjustmentsSchema>;

export function applyPartialAdjustments(base: MaskAdjustments, p: PartialMaskAdjustments): MaskAdjustments {
  const out = structuredClone(base);
  for (const n of MASK_SLIDER_NAMES) if (p[n] !== undefined) out[n] = p[n]!;
  if (p.toneCurve) out.toneCurve = normalizeCurve(p.toneCurve);
  if (p.hsl) {
    for (const ch of ["hue", "saturation", "luminance"] as const) Object.assign(out.hsl[ch], p.hsl[ch] ?? {});
  }
  return out;
}

export function applyPartial(base: EditRecipe, p: PartialRecipe): EditRecipe {
  const out = structuredClone(base);
  for (const n of SLIDER_NAMES) if (p[n] !== undefined) out[n] = p[n]!;
  if (p.toneCurve) out.toneCurve = normalizeCurve(p.toneCurve);
  if (p.hsl) {
    for (const ch of ["hue", "saturation", "luminance"] as const) Object.assign(out.hsl[ch], p.hsl[ch] ?? {});
  }
  if (p.crop) out.crop = { ...out.crop, ...p.crop };
  if (p.masks) out.masks = structuredClone(p.masks);
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
