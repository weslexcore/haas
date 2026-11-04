/// <reference lib="webworker" />
import exifr from "exifr";
import type { PhotoIndexData } from "../../core/services";
import type { ExifSummary } from "../../core/state/types";
import type { PreviewTask, ThumbnailResult, WorkerRequest, WorkerResponse } from "./protocol";

/**
 * Decoding off the main thread: EXIF index data and oriented JPEG thumbnails.
 */

const PICK = [
  "DateTimeOriginal",
  "CreateDate",
  "Make",
  "Model",
  "LensModel",
  "FocalLength",
  "FNumber",
  "ExposureTime",
  "ISO",
  "Orientation",
  "ExifImageWidth",
  "ExifImageHeight",
  "ImageWidth",
  "ImageHeight",
];

type Tags = Record<string, unknown>;

async function readTags(file: Blob): Promise<Tags | null> {
  try {
    return ((await exifr.parse(file, { pick: PICK, reviveValues: false, translateValues: false })) as Tags) ?? null;
  } catch {
    return null;
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().replace(/\0/g, "") : undefined);

/** EXIF "2026:09:12 06:30:00" → "2026-09-12T06:30:00". */
function exifDate(v: unknown): string | undefined {
  const m = typeof v === "string" ? /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : undefined;
}

async function pngSize(file: Blob): Promise<{ width: number; height: number } | null> {
  const b = new DataView(await file.slice(0, 24).arrayBuffer());
  return b.byteLength >= 24 && b.getUint32(12) === 0x49484452 ? { width: b.getUint32(16), height: b.getUint32(20) } : null;
}

async function index(file: Blob, mimeType: string): Promise<PhotoIndexData> {
  const tags = await readTags(file);
  const out: PhotoIndexData = {};
  if (tags) {
    out.capturedAt = exifDate(tags.DateTimeOriginal) ?? exifDate(tags.CreateDate);
    const exif: ExifSummary = {
      make: str(tags.Make),
      model: str(tags.Model),
      lens: str(tags.LensModel),
      focalLength: num(tags.FocalLength),
      aperture: num(tags.FNumber),
      exposureTime: num(tags.ExposureTime),
      iso: num(tags.ISO),
    };
    const clean = Object.fromEntries(Object.entries(exif).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length) out.exif = clean;
    let w = num(tags.ExifImageWidth) ?? num(tags.ImageWidth);
    let h = num(tags.ExifImageHeight) ?? num(tags.ImageHeight);
    if (w && h && (num(tags.Orientation) ?? 1) >= 5) [w, h] = [h, w];
    if (w && h) Object.assign(out, { width: w, height: h });
  }
  if (!out.width && mimeType === "image/png") Object.assign(out, await pngSize(file));
  if (!out.width) {
    try {
      const bmp = await createImageBitmap(file);
      Object.assign(out, { width: bmp.width, height: bmp.height });
      bmp.close();
    } catch {
      // Undecodable here (e.g. HEIC in Chromium): leave dimensions unknown.
    }
  }
  if (!out.capturedAt) delete out.capturedAt;
  return out;
}

/** Apply an EXIF orientation (1–8) while drawing `w`×`h` source pixels. */
function orient(ctx: OffscreenCanvasRenderingContext2D, o: number, w: number, h: number): void {
  const t: Record<number, [number, number, number, number, number, number]> = {
    2: [-1, 0, 0, 1, w, 0],
    3: [-1, 0, 0, -1, w, h],
    4: [1, 0, 0, -1, 0, h],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, h, 0],
    7: [0, -1, -1, 0, h, w],
    8: [0, -1, 1, 0, 0, w],
  };
  const m = t[o];
  if (m) ctx.transform(...m);
}

async function thumbnail(task: Extract<PreviewTask, { type: "thumbnail" }>): Promise<ThumbnailResult | null> {
  const { file, maxSize } = task;
  const given = task.orientation !== undefined;
  let orientation = task.orientation ?? 1;
  let needsOrientation = given;
  let bitmap: ImageBitmap | null = null;

  if (file instanceof ImageBitmap) {
    bitmap = file;
  } else if (given) {
    // Orientation is given. Browsers apply a JPEG's own EXIF orientation whatever
    // imageOrientation says (Chromium ignores "none"), so rotate here only when the
    // preview doesn't carry one.
    bitmap = await createImageBitmap(file).catch(() => null);
    if (((await exifr.orientation(file).catch(() => 1)) ?? 1) !== 1) needsOrientation = false;
  } else {
    // Embedded EXIF thumbnails are usually ~160px: only good enough for small sizes.
    try {
      const embedded = await exifr.thumbnail(file);
      if (embedded && embedded.byteLength > 2000) {
        const b = await createImageBitmap(new Blob([embedded as BlobPart], { type: "image/jpeg" }));
        if (Math.max(b.width, b.height) >= maxSize) {
          bitmap = b;
          needsOrientation = true;
          orientation = (await exifr.orientation(file).catch(() => 1)) ?? 1;
        } else b.close();
      }
    } catch {
      // fall through to a full decode
    }
    // Full decode applies EXIF orientation itself ("from-image" is the default).
    bitmap ??= await createImageBitmap(file, { resizeWidth: maxSize * 2, resizeQuality: "medium" })
      .catch(() => createImageBitmap(file))
      .catch(() => null); // unsupported format in this browser
  }
  if (!bitmap) return null;

  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const swap = needsOrientation && orientation >= 5;
  const canvas = new OffscreenCanvas(swap ? h : w, swap ? w : h);
  const ctx = canvas.getContext("2d")!;
  if (needsOrientation) orient(ctx, orientation, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: task.quality ?? 0.82 });
  return { blob, width: canvas.width, height: canvas.height };
}

async function run(task: PreviewTask): Promise<unknown> {
  return task.type === "thumbnail" ? thumbnail(task) : index(task.file, task.mimeType);
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, task } = e.data;
  let response: WorkerResponse;
  try {
    response = { id, ok: true, result: await run(task) };
  } catch (error) {
    response = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};
