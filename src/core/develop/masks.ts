import { HSL_BANDS, MASK_SLIDER_NAMES, type Mask, type MaskShape, type MaskShapeType, type SegmentTarget } from "./recipe";

/**
 * Mask geometry: how much of each mask covers a pixel. The WebGL2 shader
 * (adapters/render/shaders.ts, `maskWeight`) implements exactly these
 * formulas; tests render on the GPU and compare against `maskWeight` here.
 *
 * Positions are in source uv: fractions of the oriented, uncropped photo,
 * (0,0) top-left. Distances are measured in units of the photo's height
 * (x is scaled by the aspect ratio), so a circle is round on screen.
 * Luminance and colour masks read the original pixel, before any edit.
 */

/**
 * A soft mask over the whole photo as 8-bit coverage (0–255), row-major,
 * `width` × `height`, aligned with the photo's uv (stretched to fit, so it
 * needn't share the photo's aspect ratio). Produced by segmentation.
 */
export interface MaskBitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Mask bitmaps by mask id, for the segment masks of one recipe. */
export type MaskBitmaps = Record<string, MaskBitmap>;

export const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** Smallest feather, so the soft edge never has zero width (smoothstep(a, a, x) is undefined). */
export const MIN_FEATHER = 0.001;

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

/**
 * The shape's numbers as the shader receives them: two vec4s, P and Q, in
 * the units the formulas use (turns, fractions, radians). Shared by the CPU
 * reference below and the renderer's uniform upload.
 */
export function shapeParams(shape: MaskShape): { p: [number, number, number, number]; q: [number, number, number, number] } {
  switch (shape.type) {
    case "linear":
      return { p: [shape.from.x, shape.from.y, shape.to.x, shape.to.y], q: [0, 0, 0, 0] };
    case "radial":
      return {
        p: [shape.center.x, shape.center.y, shape.radiusX, shape.radiusY],
        q: [(shape.angle * Math.PI) / 180, Math.max(MIN_FEATHER, shape.feather / 100), 0, 0],
      };
    case "luminance":
      return { p: [shape.low / 100, shape.high / 100, Math.max(MIN_FEATHER, shape.feather / 100), 0], q: [0, 0, 0, 0] };
    case "color":
      // Hue in turns, half the range in turns, and the feather: 100 softens over a quarter turn.
      return { p: [shape.hue / 360, shape.range / 720, Math.max(MIN_FEATHER, (shape.feather / 100) * 0.25), 0], q: [0, 0, 0, 0] };
    case "segment":
      return { p: [0, 0, 0, 0], q: [0, 0, 0, 0] };
  }
}

/** Shape type codes in the shader. */
export const SHAPE_CODES: Record<MaskShapeType, number> = { linear: 0, radial: 1, luminance: 2, color: 3, segment: 4 };
/** A segment mask whose bitmap isn't available yet: covers nothing. */
export const SHAPE_CODE_NONE = 5;

/** Bilinear sample of a bitmap at uv, matching the GPU's linear filtering with clamped edges. 0–1. */
export function sampleBitmap(bitmap: MaskBitmap, u: number, v: number): number {
  const x = clamp(u) * bitmap.width - 0.5;
  const y = clamp(v) * bitmap.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (px: number, py: number) => bitmap.data[clamp(py, 0, bitmap.height - 1) * bitmap.width + clamp(px, 0, bitmap.width - 1)]! / 255;
  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const d = at(x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Coverage (0–1) of one mask at source uv (u, v) for the original pixel
 * (r, g, b) in sRGB 0–1. `aspect` is the photo's width/height. Inversion
 * is applied; `enabled` is not. A segment mask without its bitmap covers
 * nothing.
 */
export function maskWeight(mask: Mask, u: number, v: number, rgb: readonly [number, number, number], aspect: number, bitmap?: MaskBitmap): number {
  const { shape } = mask;
  const { p, q } = shapeParams(shape);
  let w: number;
  switch (shape.type) {
    case "linear": {
      const ax = p[0] * aspect;
      const ay = p[1];
      const dx = p[2] * aspect - ax;
      const dy = p[3] - ay;
      const l2 = Math.max(dx * dx + dy * dy, 1e-8);
      w = 1 - clamp(((u * aspect - ax) * dx + (v - ay) * dy) / l2);
      break;
    }
    case "radial": {
      const px = (u - p[0]) * aspect;
      const py = v - p[1];
      const cs = Math.cos(q[0]);
      const sn = Math.sin(q[0]);
      const rx = cs * px + sn * py;
      const ry = -sn * px + cs * py;
      const nd = Math.hypot(rx / (p[2] * aspect), ry / p[3]);
      w = 1 - smoothstep(1 - q[1], 1, nd);
      break;
    }
    case "luminance": {
      const L = rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2];
      w = smoothstep(p[0] - p[2], p[0], L) * (1 - smoothstep(p[1], p[1] + p[2], L));
      break;
    }
    case "color": {
      const [h, s] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      let dh = Math.abs(h - p[0]);
      dh = Math.min(dh, 1 - dh);
      w = (1 - smoothstep(p[1], p[1] + p[2], dh)) * smoothstep(0.05, 0.3, s);
      break;
    }
    case "segment":
      w = bitmap ? sampleBitmap(bitmap, u, v) : 0;
      break;
  }
  return mask.invert ? 1 - w : w;
}

/** Whether a mask changes anything (any non-neutral adjustment). */
export function hasAdjustments(mask: Mask): boolean {
  const a = mask.adjustments;
  if (MASK_SLIDER_NAMES.some((n) => a[n] !== 0)) return true;
  if (a.toneCurve.length !== 2 || a.toneCurve[0]![0] !== 0 || a.toneCurve[0]![1] !== 0 || a.toneCurve[1]![0] !== 1 || a.toneCurve[1]![1] !== 1) return true;
  return HSL_BANDS.some((b) => a.hsl.hue[b] !== 0 || a.hsl.saturation[b] !== 0 || a.hsl.luminance[b] !== 0);
}

export const SEGMENT_LABELS: Record<SegmentTarget, string> = {
  subject: "Subject",
  sky: "Sky",
  background: "Background",
  people: "People",
  vegetation: "Vegetation",
  water: "Water",
};

/** The mask's name, or one made from its shape. */
export function maskLabel(mask: Pick<Mask, "name" | "shape">): string {
  if (mask.name) return mask.name;
  switch (mask.shape.type) {
    case "linear":
      return "Linear Gradient";
    case "radial":
      return "Radial Gradient";
    case "luminance":
      return "Luminance Range";
    case "color":
      return "Colour Range";
    case "segment":
      return SEGMENT_LABELS[mask.shape.target];
  }
}

/** Default shapes for a new mask: a gradient across the top, an ellipse in the middle, a hue, mid-tones. */
export function defaultShape(type: MaskShapeType, target: SegmentTarget = "subject"): MaskShape {
  switch (type) {
    case "linear":
      return { type, from: { x: 0.5, y: 0.1 }, to: { x: 0.5, y: 0.55 } };
    case "radial":
      return { type, center: { x: 0.5, y: 0.5 }, radiusX: 0.3, radiusY: 0.35, angle: 0, feather: 50 };
    case "luminance":
      return { type, low: 0, high: 35, feather: 20 };
    case "color":
      return { type, hue: 210, range: 40, feather: 50 };
    case "segment":
      return { type, target };
  }
}

/** A new mask id: short, random, unlikely to collide within a photo. */
export function newMaskId(existing: readonly Mask[] = []): string {
  for (;;) {
    const id = `m${Math.random().toString(36).slice(2, 8)}`;
    if (!existing.some((m) => m.id === id)) return id;
  }
}

/** The segment masks of a recipe, in order (each needs a bitmap to render). */
export function segmentMasks(masks: readonly Mask[] | undefined): Array<Mask & { shape: Extract<MaskShape, { type: "segment" }> }> {
  return (masks ?? []).filter((m): m is Mask & { shape: Extract<MaskShape, { type: "segment" }> } => m.shape.type === "segment");
}

/** Resample a bitmap to another size (nearest neighbour), for packing bitmaps of different sizes into one texture. */
export function resampleBitmap(bitmap: MaskBitmap, width: number, height: number): MaskBitmap {
  if (bitmap.width === width && bitmap.height === height) return bitmap;
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(bitmap.height - 1, Math.floor(((y + 0.5) / height) * bitmap.height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(bitmap.width - 1, Math.floor(((x + 0.5) / width) * bitmap.width));
      data[y * width + x] = bitmap.data[sy * bitmap.width + sx]!;
    }
  }
  return { width, height, data };
}
