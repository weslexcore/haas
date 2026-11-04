/**
 * Builds small, real DNG files for tests: an uncompressed 16-bit RGGB Bayer
 * mosaic (in a SubIFD) plus an optional embedded JPEG preview (IFD0), with
 * EXIF. The "camera" colour space is linear sRGB (ColorMatrix1 is XYZ→linear
 * sRGB, neutral white balance), so a correct decode reproduces `pixel()`'s
 * colours, give or take gamma and LibRaw's auto-brightening.
 */

export interface DngOptions {
  width: number;
  height: number;
  /** Linear RGB (0–1) of the scene at (x, y). */
  pixel: (x: number, y: number) => [number, number, number];
  make?: string;
  model?: string;
  /** EXIF "YYYY:MM:DD HH:MM:SS". */
  date?: string;
  iso?: number;
  /** EXIF orientation (1, 3, 6 or 8). */
  orientation?: number;
  /** Baseline JPEG for the embedded preview, already oriented like the raw data (not rotated). */
  preview?: { jpeg: Uint8Array; width: number; height: number };
}

const BYTE = 1, ASCII = 2, SHORT = 3, LONG = 4, RATIONAL = 5, SRATIONAL = 10;
type Value = number | [number, number];
interface Entry {
  tag: number;
  type: number;
  values: Value[] | Uint8Array;
}

const TYPE_SIZE: Record<number, number> = { [BYTE]: 1, [ASCII]: 1, [SHORT]: 2, [LONG]: 4, [RATIONAL]: 8, [SRATIONAL]: 8 };
const ascii = (s: string): Uint8Array => new TextEncoder().encode(`${s}\0`);
const rational = (v: number, d = 10000): [number, number] => [Math.round(v * d), d];

/** XYZ (D65) → linear sRGB. */
const XYZ_TO_SRGB = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.204, 1.057];

export function buildDng(o: DngOptions): Uint8Array {
  const { width: W, height: H } = o;
  const WHITE = 4095;
  const raw = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const rgb = o.pixel(x, y);
      // RGGB: even rows R G, odd rows G B.
      const c = y % 2 === 0 ? (x % 2 === 0 ? 0 : 1) : x % 2 === 0 ? 1 : 2;
      raw[y * W + x] = Math.round(Math.min(1, Math.max(0, rgb[c])) * WHITE);
    }
  }
  const rawBytes = new Uint8Array(raw.buffer);

  // Offsets of the blobs are patched in once the layout is known.
  const blobs: Uint8Array[] = [rawBytes];
  if (o.preview) blobs.push(o.preview.jpeg);

  const exif: Entry[] = [
    { tag: 0x829a, type: RATIONAL, values: [[1, 250]] },
    { tag: 0x829d, type: RATIONAL, values: [[28, 10]] },
    { tag: 0x8827, type: SHORT, values: [o.iso ?? 400] },
    ...(o.date ? [{ tag: 0x9003, type: ASCII, values: ascii(o.date) }] : []),
  ];
  const sub: Entry[] = [
    { tag: 254, type: LONG, values: [0] },
    { tag: 256, type: LONG, values: [W] },
    { tag: 257, type: LONG, values: [H] },
    { tag: 258, type: SHORT, values: [16] },
    { tag: 259, type: SHORT, values: [1] },
    { tag: 262, type: SHORT, values: [32803] }, // CFA
    { tag: 273, type: LONG, values: [0] }, // StripOffsets → blob 0
    { tag: 277, type: SHORT, values: [1] },
    { tag: 278, type: LONG, values: [H] },
    { tag: 279, type: LONG, values: [rawBytes.length] },
    { tag: 33421, type: SHORT, values: [2, 2] }, // CFARepeatPatternDim
    { tag: 33422, type: BYTE, values: [0, 1, 1, 2] }, // CFAPattern RGGB
    { tag: 50714, type: SHORT, values: [0] }, // BlackLevel
    { tag: 50717, type: SHORT, values: [WHITE] }, // WhiteLevel
  ];
  const ifd0: Entry[] = [
    { tag: 254, type: LONG, values: [o.preview ? 1 : 1] },
    ...(o.preview
      ? [
          { tag: 256, type: LONG, values: [o.preview.width] },
          { tag: 257, type: LONG, values: [o.preview.height] },
          { tag: 258, type: SHORT, values: [8, 8, 8] },
          { tag: 259, type: SHORT, values: [7] }, // JPEG
          { tag: 262, type: SHORT, values: [6] }, // YCbCr
          { tag: 273, type: LONG, values: [0] }, // StripOffsets → blob 1
          { tag: 277, type: SHORT, values: [3] },
          { tag: 278, type: LONG, values: [o.preview.height] },
          { tag: 279, type: LONG, values: [o.preview.jpeg.length] },
        ]
      : []),
    { tag: 271, type: ASCII, values: ascii(o.make ?? "TestCo") },
    { tag: 272, type: ASCII, values: ascii(o.model ?? "TestRaw R1") },
    { tag: 274, type: SHORT, values: [o.orientation ?? 1] },
    { tag: 330, type: LONG, values: [0] }, // SubIFDs → raw IFD
    { tag: 34665, type: LONG, values: [0] }, // ExifIFD
    { tag: 50706, type: BYTE, values: [1, 4, 0, 0] },
    { tag: 50707, type: BYTE, values: [1, 1, 0, 0] },
    { tag: 50708, type: ASCII, values: ascii(o.model ?? "TestRaw R1") },
    { tag: 50721, type: SRATIONAL, values: XYZ_TO_SRGB.map((v) => rational(v)) }, // ColorMatrix1
    { tag: 50728, type: RATIONAL, values: [rational(1), rational(1), rational(1)] }, // AsShotNeutral
    { tag: 50778, type: SHORT, values: [21] }, // CalibrationIlluminant1 = D65
  ];
  for (const ifd of [ifd0, sub, exif]) ifd.sort((a, b) => a.tag - b.tag);

  const count = (e: Entry) => (e.values instanceof Uint8Array ? e.values.length : e.values.length);
  const payloadSize = (e: Entry) => count(e) * TYPE_SIZE[e.type]!;
  const ifdSize = (ifd: Entry[]) => 2 + ifd.length * 12 + 4 + ifd.reduce((n, e) => n + (payloadSize(e) > 4 ? payloadSize(e) + (payloadSize(e) % 2) : 0), 0);

  const ifd0At = 8;
  const subAt = ifd0At + ifdSize(ifd0);
  const exifAt = subAt + ifdSize(sub);
  let blobAt = exifAt + ifdSize(exif);
  const blobOffsets = blobs.map((b) => {
    const at = blobAt;
    blobAt += b.length + (b.length % 2);
    return at;
  });
  const set = (ifd: Entry[], tag: number, v: number) => ((ifd.find((e) => e.tag === tag)!.values as Value[])[0] = v);
  set(sub, 273, blobOffsets[0]!);
  if (o.preview) set(ifd0, 273, blobOffsets[1]!);
  set(ifd0, 330, subAt);
  set(ifd0, 34665, exifAt);

  const out = new Uint8Array(blobAt);
  const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]);
  dv.setUint32(4, ifd0At, true);

  const writeValue = (at: number, type: number, v: Value | number) => {
    if (type === BYTE || type === ASCII) dv.setUint8(at, v as number);
    else if (type === SHORT) dv.setUint16(at, v as number, true);
    else if (type === LONG) dv.setUint32(at, v as number, true);
    else if (type === RATIONAL) {
      dv.setUint32(at, (v as [number, number])[0], true);
      dv.setUint32(at + 4, (v as [number, number])[1], true);
    } else {
      dv.setInt32(at, (v as [number, number])[0], true);
      dv.setInt32(at + 4, (v as [number, number])[1], true);
    }
  };
  const writeIfd = (at: number, ifd: Entry[]) => {
    dv.setUint16(at, ifd.length, true);
    let data = at + 2 + ifd.length * 12 + 4;
    ifd.forEach((e, i) => {
      const q = at + 2 + i * 12;
      dv.setUint16(q, e.tag, true);
      dv.setUint16(q + 2, e.type, true);
      dv.setUint32(q + 4, count(e), true);
      const size = payloadSize(e);
      let p = q + 8;
      if (size > 4) {
        dv.setUint32(q + 8, data, true);
        p = data;
        data += size + (size % 2);
      }
      const values = e.values instanceof Uint8Array ? Array.from(e.values) : e.values;
      values.forEach((v, k) => writeValue(p + k * TYPE_SIZE[e.type]!, e.type, v));
    });
    dv.setUint32(at + 2 + ifd.length * 12, 0, true); // no next IFD
  };
  writeIfd(ifd0At, ifd0);
  writeIfd(subAt, sub);
  writeIfd(exifAt, exif);
  blobs.forEach((b, i) => out.set(b, blobOffsets[i]!));
  return out;
}
