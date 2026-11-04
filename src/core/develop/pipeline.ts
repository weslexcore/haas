import { HSL_BANDS, type EditRecipe, type RecipeProfile } from "./recipe";
import { curveLut, sampleLut } from "./tone-curve";

/**
 * The develop pixel pipeline, specified once here. The WebGL2 shader
 * (adapters/render/shaders.ts) implements exactly these formulas; tests render
 * on the GPU and compare against `processPixel`.
 *
 *  1. sRGB → linear
 *  2. white balance gains (luminance-normalized), exposure (×2^EV)
 *  3. tone, on perceptual luminance (L^(1/2.2)) with RGB scaled by the luminance
 *     ratio so hues don't shift: black/white points, shadows, highlights,
 *     contrast S-curve, tone curve
 *  4. post-crop vignette (in linear light, by position in the cropped frame)
 *  5. linear → sRGB
 *  6. profile (the look under the sliders): black and white mix or saturation,
 *     per-channel curves, split toning, fade, grain; blended by its amount
 *  7. HSL per band (hue/saturation/luminance), vibrance, saturation
 */

export const LUMA = [0.2126, 0.7152, 0.0722] as const;
/** Band centres in turns (fractions of the hue circle). */
export const BAND_CENTERS = [0, 30, 60, 120, 180, 240, 270, 300].map((d) => d / 360);

export interface DevelopUniforms {
  wbGains: [number, number, number];
  exposure: number;
  blackPoint: number;
  whitePoint: number;
  shadows: number;
  highlights: number;
  contrast: number;
  vibrance: number;
  saturation: number;
  /** -1 (black corners) to 1 (white corners). */
  vignette: number;
  hslHue: number[];
  hslSat: number[];
  hslLum: number[];
  curve: Uint8Array;
  /** Null when the recipe has no profile (the stage is skipped). */
  profile: ProfileUniforms | null;
}

export interface ProfileUniforms {
  /** 0–2 (amount 0–200%). */
  amount: number;
  /** Channel weights for black and white, or null for colour. */
  mono: [number, number, number] | null;
  /** -1 to 1. */
  saturation: number;
  /** Red, green and blue curve lookup tables. */
  curves: [Uint8Array, Uint8Array, Uint8Array];
  /** Colour offsets (zero luminance) added to shadows and highlights. */
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  /** -1 to 1: shifts where shadows end and highlights begin. */
  balance: number;
  /** Black level lift, 0–0.25. */
  fade: number;
  /** Grain strength, 0–1. */
  grain: number;
  /** Grain noise cells along the image's long edge. */
  grainCells: number;
}

export function wbGains(temperature: number, tint: number): [number, number, number] {
  const t = temperature / 100;
  const g = tint / 100;
  const raw: [number, number, number] = [1 + 0.25 * t, 1 - 0.2 * g, 1 - 0.25 * t];
  const y = raw[0] * LUMA[0] + raw[1] * LUMA[1] + raw[2] * LUMA[2];
  return [raw[0] / y, raw[1] / y, raw[2] / y];
}

export function uniformsFor(r: EditRecipe): DevelopUniforms {
  return {
    wbGains: wbGains(r.temperature, r.tint),
    exposure: 2 ** r.exposure,
    blackPoint: (-r.blacks / 100) * 0.15,
    whitePoint: 1 - (r.whites / 100) * 0.15,
    shadows: r.shadows / 100,
    highlights: r.highlights / 100,
    contrast: (r.contrast / 100) * 0.8,
    vibrance: r.vibrance / 100,
    saturation: r.saturation / 100,
    vignette: r.vignette / 100,
    hslHue: HSL_BANDS.map((b) => ((r.hsl.hue[b] / 100) * 30) / 360),
    hslSat: HSL_BANDS.map((b) => r.hsl.saturation[b] / 100),
    hslLum: HSL_BANDS.map((b) => r.hsl.luminance[b] / 100),
    curve: curveLut(r.toneCurve),
    profile: r.profile ? profileUniforms(r.profile) : null,
  };
}

/** Hue (degrees) and saturation (0–100) as a colour offset with zero luminance. */
function tint(hue: number, saturation: number): [number, number, number] {
  const [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
  const y = r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
  const k = (saturation / 100) * 0.25;
  return [(r - y) * k, (g - y) * k, (b - y) * k];
}

export function profileUniforms(p: RecipeProfile): ProfileUniforms {
  const { look } = p;
  const st = look.splitToning;
  return {
    amount: p.amount / 100,
    mono: look.monochrome ? [look.monochrome.red / 100, look.monochrome.green / 100, look.monochrome.blue / 100] : null,
    saturation: look.saturation / 100,
    curves: [curveLut(look.curves.red), curveLut(look.curves.green), curveLut(look.curves.blue)],
    shadowTint: tint(st.shadowHue, st.shadowSaturation),
    highlightTint: tint(st.highlightHue, st.highlightSaturation),
    balance: st.balance / 100,
    fade: (look.fade / 100) * 0.25,
    grain: look.grain.amount / 100,
    grainCells: 2400 / (1 + look.grain.size / 25),
  };
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Where the vignette starts, as a fraction of the centre-to-corner distance. */
export const VIGNETTE_START = 0.25;

/**
 * Vignette strength at a point of the cropped frame, (x, y) in 0–1: 0 at the
 * centre, rising smoothly to 1 in the corners.
 */
export function vignetteMask(x: number, y: number): number {
  const d = Math.hypot((x - 0.5) * 2, (y - 0.5) * 2) / Math.SQRT2;
  return smoothstep(VIGNETTE_START, 1, d);
}

/** 32-bit integer hash of a grid cell to [0, 1). The shader uses the same bit operations. */
function hash(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Film grain noise, -0.5 to 0.5, at a point (u, v in 0–1) of the source image:
 * smooth value noise on a grid of `cells` along the long edge, so the grain is
 * fixed to the photo whatever size it is rendered at. `aspect` is width/height.
 */
export function grainNoise(u: number, v: number, aspect: number, cells: number): number {
  const gx = u * cells * Math.min(1, aspect);
  const gy = v * cells * Math.min(1, 1 / aspect);
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  let fx = gx - ix;
  let fy = gy - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy - 0.5;
}

/** The profile stage on an sRGB pixel. `noise` is the pixel's `grainNoise`. */
export function profilePixel(r: number, g: number, b: number, p: ProfileUniforms, noise: number): [number, number, number] {
  let cr: number, cg: number, cb: number;
  if (p.mono) {
    cr = cg = cb = clamp(r * p.mono[0] + g * p.mono[1] + b * p.mono[2]);
  } else {
    const y = r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
    const k = 1 + p.saturation;
    cr = clamp(y + (r - y) * k);
    cg = clamp(y + (g - y) * k);
    cb = clamp(y + (b - y) * k);
  }
  cr = sampleLut(p.curves[0], cr);
  cg = sampleLut(p.curves[1], cg);
  cb = sampleLut(p.curves[2], cb);

  const x = clamp(cr * LUMA[0] + cg * LUMA[1] + cb * LUMA[2] - p.balance * 0.5);
  const ws = (1 - x) * (1 - x);
  const wh = x * x;
  cr = p.fade + clamp(cr + p.shadowTint[0] * ws + p.highlightTint[0] * wh) * (1 - p.fade);
  cg = p.fade + clamp(cg + p.shadowTint[1] * ws + p.highlightTint[1] * wh) * (1 - p.fade);
  cb = p.fade + clamp(cb + p.shadowTint[2] * ws + p.highlightTint[2] * wh) * (1 - p.fade);

  if (p.grain > 0) {
    const l = cr * LUMA[0] + cg * LUMA[1] + cb * LUMA[2];
    const n = noise * p.grain * 0.25 * (0.25 + 3 * l * (1 - l));
    cr += n;
    cg += n;
    cb += n;
  }
  return [clamp(r + (clamp(cr) - r) * p.amount), clamp(g + (clamp(cg) - g) * p.amount), clamp(b + (clamp(cb) - b) * p.amount)];
}

export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** Tone mapping of perceptual luminance. Values above 1 (blown highlights) are carried through. */
export function tone(pl: number, u: DevelopUniforms): number {
  let x = (pl - u.blackPoint) / (u.whitePoint - u.blackPoint);
  let xc = clamp(x);
  x += u.shadows * 1.2 * xc * (1 - xc) * (1 - xc);
  if (u.highlights < 0) {
    // Recovery: soft roll-off above the midpoint that also pulls blown values (> 1) back into range.
    if (x > 0.5) x = 0.5 + (x - 0.5) / (1 + -u.highlights * 2 * (x - 0.5));
  } else {
    xc = clamp(x);
    x += u.highlights * 1.2 * xc * xc * (1 - xc);
  }
  xc = clamp(x);
  const e = 1 + u.contrast;
  const s = xc < 0.5 ? 0.5 * (2 * xc) ** e : 1 - 0.5 * (2 * (1 - xc)) ** e;
  x = s + (x - xc);
  xc = clamp(x);
  return sampleLut(u.curve, xc) + (x - xc);
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
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

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s < 1e-6) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

/** Interpolated per-band adjustment at hue h (turns): [hue, sat, lum]. */
export function bandAdjust(h: number, u: DevelopUniforms): [number, number, number] {
  for (let i = 0; i < 8; i++) {
    const a = BAND_CENTERS[i]!;
    const b = i === 7 ? 1 : BAND_CENTERS[i + 1]!;
    if (h >= a && h < b) {
      const t = (h - a) / (b - a);
      const j = (i + 1) % 8;
      const mix = (arr: number[]) => arr[i]! + (arr[j]! - arr[i]!) * t;
      return [mix(u.hslHue), mix(u.hslSat), mix(u.hslLum)];
    }
  }
  return [u.hslHue[0]!, u.hslSat[0]!, u.hslLum[0]!];
}

/**
 * Process one sRGB pixel (0–1 per channel). `mask` is the pixel's
 * `vignetteMask` and `noise` its `grainNoise`.
 */
export function processPixel(r: number, g: number, b: number, u: DevelopUniforms, mask = 0, noise = 0): [number, number, number] {
  let lr = srgbToLinear(r) * u.wbGains[0] * u.exposure;
  let lg = srgbToLinear(g) * u.wbGains[1] * u.exposure;
  let lb = srgbToLinear(b) * u.wbGains[2] * u.exposure;

  const L = lr * LUMA[0] + lg * LUMA[1] + lb * LUMA[2];
  const pl = Math.max(L, 0) ** (1 / 2.2);
  const L2 = Math.max(tone(pl, u), 0) ** 2.2;
  if (L > 1e-5) {
    const k = L2 / L;
    lr *= k;
    lg *= k;
    lb *= k;
  } else {
    lr = lg = lb = L2;
  }

  let cr = clamp(lr);
  let cg = clamp(lg);
  let cb = clamp(lb);
  const v = u.vignette * mask;
  if (v < 0) {
    cr *= 1 + v;
    cg *= 1 + v;
    cb *= 1 + v;
  } else if (v > 0) {
    cr += (1 - cr) * v;
    cg += (1 - cg) * v;
    cb += (1 - cb) * v;
  }

  let sr = linearToSrgb(cr);
  let sg = linearToSrgb(cg);
  let sb = linearToSrgb(cb);
  if (u.profile) [sr, sg, sb] = profilePixel(sr, sg, sb, u.profile, noise);

  let [h, s, l] = rgbToHsl(sr, sg, sb);
  const [dh, ds, dl] = bandAdjust(h, u);
  const s0 = s;
  h = h + dh;
  h -= Math.floor(h);
  s *= 1 + ds;
  l += dl * 0.3 * s0;
  s *= 1 + u.vibrance * (1 - clamp(s));
  s *= 1 + u.saturation;
  return hslToRgb(h, clamp(s), clamp(l));
}

/**
 * Apply the pipeline to RGBA8 pixels in place (CPU reference; also used for
 * tests). The pixels are taken to be the whole cropped frame, `width` across,
 * and (for grain) the uncropped source; without a width the vignette and
 * grain are skipped.
 */
export function processImageData(data: Uint8ClampedArray | Uint8Array, recipe: EditRecipe, width?: number): void {
  const u = uniformsFor(recipe);
  const height = width ? data.length / 4 / width : 0;
  const grain = width && u.profile && u.profile.grain > 0 ? u.profile.grainCells : 0;
  for (let i = 0; i < data.length; i += 4) {
    const px = i / 4;
    const x = width ? ((px % width) + 0.5) / width : 0;
    const y = width ? (Math.floor(px / width) + 0.5) / height : 0;
    const mask = width && u.vignette !== 0 ? vignetteMask(x, y) : 0;
    const noise = grain ? grainNoise(x, y, width! / height, grain) : 0;
    const [r, g, b] = processPixel(data[i]! / 255, data[i + 1]! / 255, data[i + 2]! / 255, u, mask, noise);
    data[i] = Math.round(r * 255);
    data[i + 1] = Math.round(g * 255);
    data[i + 2] = Math.round(b * 255);
  }
}

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  l: Uint32Array;
  /** Pixels clipped to pure black / pure white in any channel. */
  clippedShadows: number;
  clippedHighlights: number;
  total: number;
}

export function computeHistogram(rgba: Uint8Array | Uint8ClampedArray): Histogram {
  const h: Histogram = {
    r: new Uint32Array(256),
    g: new Uint32Array(256),
    b: new Uint32Array(256),
    l: new Uint32Array(256),
    clippedShadows: 0,
    clippedHighlights: 0,
    total: rgba.length / 4,
  };
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    h.r[r]!++;
    h.g[g]!++;
    h.b[b]!++;
    h.l[Math.round(r * 0.2126 + g * 0.7152 + b * 0.0722)]!++;
    if (r === 0 && g === 0 && b === 0) h.clippedShadows++;
    if (r === 255 || g === 255 || b === 255) h.clippedHighlights++;
  }
  return h;
}
