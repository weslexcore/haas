import type { CropRect } from "./recipe";

export interface Size {
  width: number;
  height: number;
}

/**
 * Crop geometry. The crop rectangle is given in the straightened frame: the
 * source image rotated by `angle` degrees clockwise about its centre, with
 * (0,0)–(1,1) spanning the source's own width and height.
 */

/** Affine map [a, b, c, d, e, f]: su = a·u + b·v + c, sv = d·u + e·v + f. */
export type Affine = [number, number, number, number, number, number];

/** Map output uv (0–1, y down) to source uv (0–1, y down). */
export function cropToSourceAffine(src: Size, crop: CropRect): Affine {
  const t = (crop.angle * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const W = src.width;
  const H = src.height;
  // Output uv → straightened-frame pixels relative to the centre.
  //   X = (crop.x + u·w − 0.5)·W,  Y = (crop.y + v·h − 0.5)·H
  // Straightened → source (undo a clockwise rotation, y down):
  //   Xs = cos·X + sin·Y,  Ys = −sin·X + cos·Y
  // Source pixels → uv: su = Xs/W + 0.5, sv = Ys/H + 0.5
  const ax = crop.width * W;
  const by = crop.height * H;
  const X0 = (crop.x - 0.5) * W;
  const Y0 = (crop.y - 0.5) * H;
  return [
    (cos * ax) / W,
    (sin * by) / W,
    (cos * X0 + sin * Y0) / W + 0.5,
    (-sin * ax) / H,
    (cos * by) / H,
    (-sin * X0 + cos * Y0) / H + 0.5,
  ];
}

export function applyAffine(m: Affine, u: number, v: number): [number, number] {
  return [m[0] * u + m[1] * v + m[2], m[3] * u + m[4] * v + m[5]];
}

/** Column-major mat3 for GLSL. */
export function affineToMat3(m: Affine): Float32Array {
  return new Float32Array([m[0], m[3], 0, m[1], m[4], 0, m[2], m[5], 1]);
}

/** Output pixel size for a crop. */
export function cropOutputSize(src: Size, crop: CropRect): Size {
  return {
    width: Math.max(1, Math.round(crop.width * src.width)),
    height: Math.max(1, Math.round(crop.height * src.height)),
  };
}

/** Scale `size` to fit within maxEdge on its long side (never enlarges). */
export function fitWithin(size: Size, maxEdge: number): Size {
  const s = Math.min(1, maxEdge / Math.max(size.width, size.height));
  return { width: Math.max(1, Math.round(size.width * s)), height: Math.max(1, Math.round(size.height * s)) };
}

const EPS = 1e-6;

function insideSource(src: Size, crop: CropRect): boolean {
  const m = cropToSourceAffine(src, crop);
  return ([
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const).every(([u, v]) => {
    const [x, y] = applyAffine(m, u, v);
    return x >= -EPS && x <= 1 + EPS && y >= -EPS && y <= 1 + EPS;
  });
}

/**
 * Keep the crop entirely inside the (rotated) photo, as Lightroom does when
 * straightening: shrink about the rectangle's centre, keeping its aspect
 * ratio, and pull the centre inwards if needed.
 */
export function constrainCrop(src: Size, crop: CropRect): CropRect {
  let c = clampRect(crop);
  if (insideSource(src, c)) return c;
  const cx = c.x + c.width / 2;
  const cy = c.y + c.height / 2;
  const scaled = (s: number, x = cx, y = cy): CropRect => ({
    ...c,
    x: x - (c.width * s) / 2,
    y: y - (c.height * s) / 2,
    width: c.width * s,
    height: c.height * s,
  });
  // If even a tiny rectangle at this centre falls outside, move the centre to the middle.
  let center = { x: cx, y: cy };
  if (!insideSource(src, scaled(0.01))) center = { x: 0.5, y: 0.5 };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (insideSource(src, scaled(mid, center.x, center.y))) lo = mid;
    else hi = mid;
  }
  c = scaled(lo, center.x, center.y);
  return c;
}

function clampRect(c: CropRect): CropRect {
  const width = Math.min(1, Math.max(0.01, c.width));
  const height = Math.min(1, Math.max(0.01, c.height));
  return {
    ...c,
    width,
    height,
    x: Math.min(1 - width, Math.max(0, c.x)),
    y: Math.min(1 - height, Math.max(0, c.y)),
  };
}

/** A crop with the given aspect ratio (w/h in output pixels), as large as fits, centred. */
export function cropForAspect(src: Size, aspect: number, angle: number): CropRect {
  const srcAspect = src.width / src.height;
  // width/height fractions such that (w·W)/(h·H) = aspect
  let w = 1;
  let h = srcAspect / aspect;
  if (h > 1) {
    w = aspect / srcAspect;
    h = 1;
  }
  return constrainCrop(src, { x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h, angle });
}

export interface Point {
  x: number;
  y: number;
}

const clampAngle = (a: number) => Math.round(Math.min(45, Math.max(-45, a)) * 100) / 100;

/**
 * Straighten angle after dragging around `center` from `start` to `current`
 * (any isotropic coordinates, y down). Dragging clockwise rotates the photo
 * clockwise.
 */
export function rotateByDrag(angle: number, center: Point, start: Point, current: Point): number {
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const a1 = Math.atan2(current.y - center.y, current.x - center.x);
  let delta = ((a1 - a0) * 180) / Math.PI;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return clampAngle(angle + delta);
}

/**
 * Straighten angle that makes a line drawn on the straightened frame level:
 * horizontal if it is closer to horizontal, otherwise vertical. `from`/`to`
 * are fractions of the frame (0–1, y down); `src` gives its pixel shape.
 * Returns null for a line too short to measure.
 */
export function levelAngle(src: Size, angle: number, from: Point, to: Point): number | null {
  const dx = (to.x - from.x) * src.width;
  const dy = (to.y - from.y) * src.height;
  if (Math.hypot(dx, dy) < 1e-3 * Math.max(src.width, src.height)) return null;
  let tilt = (Math.atan2(dy, dx) * 180) / Math.PI; // clockwise from horizontal, −180…180
  // Fold into −45…45 relative to the nearest horizontal or vertical.
  tilt = ((((tilt + 45) % 90) + 90) % 90) - 45;
  return clampAngle(angle - tilt);
}
