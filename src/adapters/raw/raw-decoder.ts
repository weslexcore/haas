import type LibRaw from "libraw-wasm";
import type { LibRawOptions } from "libraw-wasm";

/**
 * Camera RAW decoding with LibRaw compiled to WebAssembly (libraw-wasm),
 * which runs in its own worker. Needs cross-origin isolation (its threads use
 * SharedArrayBuffer); without it, RAW files are listed but can't be shown.
 *
 * Opening a file only parses its header, so metadata and the embedded JPEG
 * preview are cheap; demosaicing the sensor data (`decode`) is the slow part.
 * Two lanes keep a long decode from holding up grid thumbnails.
 */

export interface RawInfo {
  /** Output size, already rotated for the photo's orientation. */
  width: number;
  height: number;
  /** EXIF orientation (1, 3, 6 or 8) the embedded preview needs. */
  orientation: number;
  make?: string;
  model?: string;
  iso?: number;
  exposureTime?: number;
  aperture?: number;
  focalLength?: number;
  /** Capture time (camera-local clock read as local time). */
  timestamp?: Date;
}

export interface RawPreview {
  /** The camera's embedded JPEG, in sensor orientation (apply `orientation`). */
  blob: Blob;
  width: number;
  height: number;
  orientation: number;
}

/** LibRaw's flip (0, 3, 5, 6) as an EXIF orientation. */
const FLIP_TO_ORIENTATION: Record<number, number> = { 0: 1, 3: 3, 5: 8, 6: 6 };

const DECODE_SETTINGS: LibRawOptions = {
  useCameraWb: true, // as shot, like Lightroom's default
  outputBps: 8,
  outputColor: 1, // sRGB
  userQual: 3, // AHD demosaic
  highlight: 0, // clip
};

/** Drop an idle LibRaw instance (and its worker and memory) after this long. */
const IDLE_MS = 60_000;

/**
 * Why RAW decoding is unavailable on this page, or null when it works.
 * LibRaw's threads need SharedArrayBuffer, which browsers expose only on
 * cross-origin isolated pages: COOP/COEP headers on every response, over
 * HTTPS or localhost.
 */
export function rawUnavailableReason(): string | null {
  if (typeof Worker === "undefined") return "this browser has no Web Workers";
  if (typeof crossOriginIsolated !== "undefined" && crossOriginIsolated) return null;
  if (typeof isSecureContext !== "undefined" && !isSecureContext) return "the page isn't a secure context (open it over https:// or on localhost)";
  return "the page isn't cross-origin isolated (the server must send Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp on every response)";
}

export const rawSupported = () => rawUnavailableReason() === null;

let warned = false;
/** True when RAW decoding can't run here; says why in the console, once. */
function unavailable(): boolean {
  const reason = rawUnavailableReason();
  if (reason && !warned) {
    warned = true;
    console.warn(`RAW files can't be decoded: ${reason}.`);
  }
  return reason !== null;
}

/** One LibRaw instance, used by one job at a time (open + reads must not interleave). */
class Lane {
  private instance: LibRaw | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private idle: ReturnType<typeof setTimeout> | undefined;

  run<T>(job: (raw: LibRaw) => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      clearTimeout(this.idle);
      if (!this.instance) {
        const { default: LibRawClass } = await import("libraw-wasm");
        this.instance = new LibRawClass();
      }
      try {
        return await job(this.instance);
      } catch (e) {
        // A failed decode may leave the worker in a bad state (or out of memory): start fresh next time.
        this.dispose();
        throw e;
      } finally {
        this.idle = setTimeout(() => this.dispose(), IDLE_MS);
      }
    });
    this.tail = next.catch(() => undefined);
    return next;
  }

  dispose(): void {
    clearTimeout(this.idle);
    this.instance?.dispose();
    this.instance = null;
  }
}

const bytesOf = async (file: Blob) => new Uint8Array(await file.arrayBuffer());

/** LibRaw's metadata floats are single precision: 2.2 arrives as 2.200000047683716. */
const single = (v: number) => Number(v.toPrecision(6));

export class RawDecoder {
  /** Metadata and embedded previews. */
  private readonly quick = new Lane();
  /** Full decodes. */
  private readonly heavy = new Lane();

  async info(file: Blob): Promise<RawInfo | null> {
    if (unavailable()) return null;
    const data = await bytesOf(file);
    return this.quick.run(async (raw) => {
      await raw.open(data);
      const m = await raw.metadata();
      if (!m?.width || !m.height) return null;
      const info: RawInfo = { width: m.width, height: m.height, orientation: FLIP_TO_ORIENTATION[m.flip] ?? 1 };
      if (m.camera_make) info.make = m.camera_make;
      if (m.camera_model) info.model = m.camera_model;
      if (m.iso_speed > 0) info.iso = Math.round(m.iso_speed);
      if (m.shutter > 0) info.exposureTime = single(m.shutter);
      if (m.aperture > 0) info.aperture = single(m.aperture);
      if (m.focal_len > 0) info.focalLength = single(m.focal_len);
      if (m.timestamp instanceof Date && m.timestamp.getTime() > 0) info.timestamp = m.timestamp;
      return info;
    });
  }

  /** The camera's embedded JPEG preview, if it has one. */
  async preview(file: Blob): Promise<RawPreview | null> {
    if (unavailable()) return null;
    const data = await bytesOf(file);
    return this.quick.run(async (raw) => {
      await raw.open(data);
      const m = await raw.metadata();
      // thumb_format is only known once the thumbnail is unpacked, so check the size and the result instead.
      if (!m?.thumb_width) return null;
      const thumb = await raw.thumbnailData().catch(() => undefined);
      if (!thumb || thumb.format !== "jpeg" || !thumb.data.length) return null;
      return {
        blob: new Blob([thumb.data as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }),
        width: thumb.width,
        height: thumb.height,
        orientation: FLIP_TO_ORIENTATION[m.flip] ?? 1,
      };
    });
  }

  /**
   * Demosaic the sensor data: sRGB, camera white balance, rotated upright.
   * `half` decodes at half size (each side), about four times faster.
   */
  async decode(file: Blob, opts: { half?: boolean } = {}): Promise<ImageData | null> {
    if (unavailable()) return null;
    const data = await bytesOf(file);
    return this.heavy.run(async (raw) => {
      await raw.open(data, { ...DECODE_SETTINGS, halfSize: !!opts.half });
      const img = await raw.imageData();
      if (!img?.width || !img.height || img.colors !== 3 || img.bits !== 8) return null;
      const rgb = img.data as Uint8Array;
      const rgba = new Uint8ClampedArray(img.width * img.height * 4);
      for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
        rgba[j] = rgb[i]!;
        rgba[j + 1] = rgb[i + 1]!;
        rgba[j + 2] = rgb[i + 2]!;
        rgba[j + 3] = 255;
      }
      return new ImageData(rgba, img.width, img.height);
    });
  }

  dispose(): void {
    this.quick.dispose();
    this.heavy.dispose();
  }
}
