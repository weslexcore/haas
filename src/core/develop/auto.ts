import { applyAffine, cropToSourceAffine } from "./crop";
import { LUMA, processPixel, rgbToHsl, srgbToLinear, uniformsFor } from "./pipeline";
import { SLIDERS, type EditRecipe, type PartialRecipe, type SliderName } from "./recipe";

/**
 * Auto Tone and Auto White Balance. Settings are solved against the CPU
 * pipeline itself on a small sample of the photo (inside its crop), so they
 * account for the profile and the other settings and land the same on the GPU.
 */

export interface PixelData {
  width: number;
  height: number;
  /** RGBA8, top row first. */
  data: Uint8ClampedArray | Uint8Array;
}

export type AutoPart = "tone" | "wb";

/** Sliders Auto Tone sets (from neutral, so running it twice gives the same result). */
export const AUTO_TONE_SLIDERS = ["exposure", "contrast", "highlights", "shadows", "whites", "blacks", "vibrance"] as const satisfies readonly SliderName[];

const GRID = 64;
/** Targets for the output, in display (sRGB) luminance. */
const TARGET = { white: 0.93, black: 0.04, spread: 0.62 };
/**
 * Mid-tones in this range count as well exposed, and exposure isn't moved;
 * outside it the median is brought just inside. (Chasing one exact median
 * would darken a full-range photo, compressing highlights that Whites can't
 * recover.)
 */
const MEDIAN_BAND = { low: 0.38, high: 0.55, margin: 0.02 };
/**
 * How far Auto may move the white and black points. They only stretch the
 * range (whites up, blacks down): clipping is the highlight and shadow
 * sliders' job, and a photo with no real highlights (fog, a night scene)
 * shouldn't get the slider's extreme.
 */
const WHITES_RANGE = [0, 60] as const;
const BLACKS_RANGE = [-60, 0] as const;
/** Output luminance counted as clipped, for highlight and shadow recovery. */
const CLIPPED = { high: 0.99, low: 0.01 };

/** sRGB samples (0–1, flat RGB triples) on a GRID × GRID lattice over the cropped frame. */
export function samplePixels(px: PixelData, crop: EditRecipe["crop"], grid = GRID): Float32Array {
  const m = cropToSourceAffine({ width: px.width, height: px.height }, crop);
  const out = new Float32Array(grid * grid * 3);
  let n = 0;
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const [u, v] = applyAffine(m, (i + 0.5) / grid, (j + 0.5) / grid);
      const x = Math.min(px.width - 1, Math.max(0, Math.floor(u * px.width)));
      const y = Math.min(px.height - 1, Math.max(0, Math.floor(v * px.height)));
      const k = (y * px.width + x) * 4;
      out[n++] = px.data[k]! / 255;
      out[n++] = px.data[k + 1]! / 255;
      out[n++] = px.data[k + 2]! / 255;
    }
  }
  return out;
}

interface Stats {
  /** Sorted output luminance. */
  luma: Float32Array;
  meanSaturation: number;
}

function evaluate(samples: Float32Array, recipe: EditRecipe): Stats {
  const u = uniformsFor(recipe);
  const count = samples.length / 3;
  const luma = new Float32Array(count);
  let sat = 0;
  for (let i = 0; i < count; i++) {
    const [r, g, b] = processPixel(samples[i * 3]!, samples[i * 3 + 1]!, samples[i * 3 + 2]!, u);
    luma[i] = r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
    sat += rgbToHsl(r, g, b)[1];
  }
  luma.sort();
  return { luma, meanSaturation: sat / count };
}

const percentile = (sorted: Float32Array, p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]!;
const fraction = (sorted: Float32Array, test: (v: number) => boolean) => {
  let n = 0;
  for (const v of sorted) if (test(v)) n++;
  return n / sorted.length;
};

/** Value in [lo, hi] where the increasing function f reaches target (bisection). */
function solve(f: (x: number) => number, lo: number, hi: number, target: number, iterations = 14): number {
  if (f(lo) >= target) return lo;
  if (f(hi) <= target) return hi;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function snap(name: SliderName, v: number): number {
  const s = SLIDERS[name];
  const stepped = Math.round(v / s.step) * s.step;
  // Avoid -0 and float noise such as 0.30000000000000004.
  return Number(clamp(stepped, s.min, s.max).toFixed(2)) || 0;
}

/**
 * White balance that neutralises the photo's cast: grey-world over the
 * mid-tones, then refined on the pixels that are close to neutral under that
 * first estimate. Damped, so warm scenes (sunsets) keep some warmth.
 */
export function autoWhiteBalance(samples: Float32Array): { temperature: number; tint: number } {
  const count = samples.length / 3;
  const lin = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) lin[i] = srgbToLinear(samples[i]!);

  const mean = (weight: (r: number, g: number, b: number) => number) => {
    let r = 0, g = 0, b = 0, w = 0;
    for (let i = 0; i < count; i++) {
      const lr = lin[i * 3]!, lg = lin[i * 3 + 1]!, lb = lin[i * 3 + 2]!;
      const pl = Math.max(0, lr * LUMA[0] + lg * LUMA[1] + lb * LUMA[2]) ** (1 / 2.2);
      if (pl < 0.1 || pl > 0.95) continue;
      const k = weight(lr, lg, lb);
      r += lr * k;
      g += lg * k;
      b += lb * k;
      w += k;
    }
    return w > 0 ? { r: r / w, g: g / w, b: b / w, w } : null;
  };

  const world = mean(() => 1);
  if (!world || world.r <= 0 || world.g <= 0 || world.b <= 0) return { temperature: 0, tint: 0 };
  const neutral = mean((r, g, b) => {
    const cr = r / world.r, cg = g / world.g, cb = b / world.b;
    const max = Math.max(cr, cg, cb);
    const chroma = max > 0 ? (max - Math.min(cr, cg, cb)) / max : 1;
    return Math.max(0, 1 - chroma / 0.25);
  });
  const m = neutral && neutral.w > count * 0.02 ? neutral : world;

  // Gains (1 + 0.25t, 1 - 0.2g, 1 - 0.25t) (see wbGains) that make the mean neutral.
  const k = m.b / m.r;
  const t = (4 * (k - 1)) / (k + 1);
  const gG = (m.r * (1 + 0.25 * t) + m.b * (1 - 0.25 * t)) / 2 / m.g;
  const g = (1 - gG) / 0.2;
  const DAMP = 0.85;
  return { temperature: snap("temperature", t * 100 * DAMP), tint: snap("tint", g * 100 * DAMP) };
}

/** Auto Tone: exposure, then highlight/shadow recovery, white and black points, contrast and vibrance. */
export function autoTone(samples: Float32Array, base: EditRecipe): Pick<PartialRecipe, (typeof AUTO_TONE_SLIDERS)[number]> {
  let r: EditRecipe = { ...base };
  for (const n of AUTO_TONE_SLIDERS) r[n] = 0;
  const at = (patch: Partial<EditRecipe>) => evaluate(samples, { ...r, ...patch });

  const median = (ev: number) => percentile(at({ exposure: ev }).luma, 0.5);
  const fitExposure = (lo: number, hi: number, start: number) => {
    const m = median(start);
    if (m >= MEDIAN_BAND.low && m <= MEDIAN_BAND.high) return start;
    const target = m < MEDIAN_BAND.low ? MEDIAN_BAND.low + MEDIAN_BAND.margin : MEDIAN_BAND.high - MEDIAN_BAND.margin;
    return snap("exposure", solve(median, lo, hi, target));
  };
  r.exposure = fitExposure(-3, 3, 0);

  let stats = at({});
  const blown = fraction(stats.luma, (v) => v > CLIPPED.high);
  const crushed = fraction(stats.luma, (v) => v < CLIPPED.low);
  r.highlights = snap("highlights", -clamp(blown * 800, 0, 70));
  r.shadows = snap("shadows", clamp(crushed * 600, 0, 60));

  // Stretch the range only at an end that isn't clipped: it would undo the recovery.
  if (r.highlights === 0) r.whites = snap("whites", solve((w) => percentile(at({ whites: w }).luma, 0.995), ...WHITES_RANGE, TARGET.white));
  if (r.shadows === 0) r.blacks = snap("blacks", solve((b) => percentile(at({ blacks: b }).luma, 0.005), ...BLACKS_RANGE, TARGET.black));

  stats = at({});
  const spread = percentile(stats.luma, 0.9) - percentile(stats.luma, 0.1);
  r.contrast = snap("contrast", clamp((TARGET.spread - spread) * 120, -30, 40));

  // The other settings move the mid-tones a little: refit exposure around its first value.
  r.exposure = fitExposure(r.exposure - 1, r.exposure + 1, r.exposure);

  stats = at({});
  r.vibrance = snap("vibrance", clamp((0.3 - stats.meanSaturation) * 50, 0, 15));

  return Object.fromEntries(AUTO_TONE_SLIDERS.map((n) => [n, r[n]])) as Pick<PartialRecipe, (typeof AUTO_TONE_SLIDERS)[number]>;
}

/** The settings Auto changes, for a photo's pixels and current recipe. White balance comes first so tone sees it. */
export function autoSettings(px: PixelData, recipe: EditRecipe, include: readonly AutoPart[]): PartialRecipe {
  const samples = samplePixels(px, recipe.crop);
  const out: PartialRecipe = {};
  let r = recipe;
  if (include.includes("wb")) {
    Object.assign(out, autoWhiteBalance(samples));
    r = { ...r, ...out } as EditRecipe;
  }
  if (include.includes("tone")) Object.assign(out, autoTone(samples, r));
  return out;
}
