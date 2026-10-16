/**
 * Tone curve: monotone cubic interpolation (Fritsch–Carlson) through the
 * control points, so the curve never overshoots or inverts between points.
 * Sampled into a 256-entry lookup table quantized to 8 bits, exactly as the
 * GPU texture stores it.
 */

export const LUT_SIZE = 256;

export function monotoneCurve(points: ReadonlyArray<readonly [number, number]>): (x: number) => number {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  if (n < 2) return (x) => x;
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1]! - ys[i]!) / Math.max(1e-9, xs[i + 1]! - xs[i]!));
  m.push(d[0]!);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2);
  m.push(d[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!;
    const b = m[i + 1]! / d[i]!;
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i]!;
      m[i + 1] = t * b * d[i]!;
    }
  }
  return (x: number) => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!;
    const t = (x - xs[i]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i]! +
      (t3 - 2 * t2 + t) * h * m[i]! +
      (-2 * t3 + 3 * t2) * ys[i + 1]! +
      (t3 - t2) * h * m[i + 1]!
    );
  };
}

/** 8-bit LUT: entry i is the curve at i/255. */
export function curveLut(points: ReadonlyArray<readonly [number, number]>): Uint8Array {
  const f = monotoneCurve(points);
  const lut = new Uint8Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) lut[i] = Math.round(Math.min(1, Math.max(0, f(i / 255))) * 255);
  return lut;
}

/** Sample the LUT with linear interpolation, matching GPU texture filtering. */
export function sampleLut(lut: Uint8Array, x: number): number {
  const t = Math.min(1, Math.max(0, x)) * 255;
  const i = Math.floor(t);
  const f = t - i;
  const a = lut[i]!;
  const b = lut[Math.min(255, i + 1)]!;
  return (a + (b - a) * f) / 255;
}
