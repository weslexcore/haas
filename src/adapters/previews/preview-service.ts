import type { PixelData } from "../../core/develop/auto";
import { isRawMimeType } from "../../core/library/formats";
import { fileKey, localIso } from "../../core/library/util";
import type { LibraryProvider, PhotoIndexData, PreviewService } from "../../core/services";
import type { PhotoRecord } from "../../core/state/types";
import type { PhotoDB } from "../db";
import { WorkerPool } from "./worker-pool";
import { sampleImage } from "../sample-image";
import { RawDecoder } from "../raw/raw-decoder";

const THUMB_SIZE = 480;
const MAX_THUMB_URLS = 1200;
const MAX_IMAGE_URLS = 5;
/** RAW in Loupe: the camera's embedded preview when it is at least this big (long edge), else a full decode. */
const RAW_LOUPE_MIN_PREVIEW = 1600;
/** RAW decodes for at most this size (thumbnails, AI vision) use the embedded preview when it is big enough. */
const RAW_SMALL_DECODE = 1024;

/** Map with insertion-order LRU eviction that revokes evicted object URLs. */
class UrlCache {
  private map = new Map<string, string>();
  constructor(private readonly max: number) {}

  get(key: string): string | undefined {
    const url = this.map.get(key);
    if (url) {
      this.map.delete(key);
      this.map.set(key, url);
    }
    return url;
  }

  set(key: string, url: string): void {
    this.map.set(key, url);
    while (this.map.size > this.max) {
      const [oldKey, oldUrl] = this.map.entries().next().value!;
      this.map.delete(oldKey);
      URL.revokeObjectURL(oldUrl);
    }
  }

  clear(): void {
    for (const url of this.map.values()) URL.revokeObjectURL(url);
    this.map.clear();
  }
}

interface Inflight {
  promise: Promise<string | null>;
  controller: AbortController;
  waiters: number;
}

/**
 * Thumbnails: memory URL cache → IndexedDB cache → worker decode.
 * Full images: object URLs of the original file (the browser decodes and
 * orients them). EXIF: worker, on the background lane.
 *
 * RAW files go through LibRaw: thumbnails and Loupe use the camera's embedded
 * JPEG preview (fast); Develop and export demosaic the sensor data.
 */
export class BrowserPreviewService implements PreviewService {
  private thumbs = new UrlCache(MAX_THUMB_URLS);
  private images = new UrlCache(MAX_IMAGE_URLS);
  private inflight = new Map<string, Inflight>();
  private readonly pool: WorkerPool;

  constructor(
    private readonly library: LibraryProvider,
    private readonly db: PhotoDB,
    pool?: WorkerPool,
    private readonly raw = new RawDecoder(),
  ) {
    this.pool =
      pool ?? new WorkerPool(() => new Worker(new URL("./preview.worker.ts", import.meta.url), { type: "module" }));
  }

  async thumbnailUrl(photo: PhotoRecord, signal?: AbortSignal): Promise<string | null> {
    const source = this.library.current();
    if (!source || photo.placeholderHue !== undefined) return null;
    // "|2": RAW thumbnails cached before the orientation fix can be sideways.
    const key = `${source.folder.id}|${photo.id}|${fileKey(photo)}${isRawMimeType(photo.mimeType) ? "|2" : ""}`;
    const cached = this.thumbs.get(key);
    if (cached) return cached;

    let entry = this.inflight.get(key);
    // A cancelled request (e.g. its cell unmounted, or React StrictMode's double mount) can't be shared.
    if (entry?.controller.signal.aborted) entry = undefined;
    if (!entry) {
      const controller = new AbortController();
      const promise = (async () => {
        const row = await this.db.thumbs.get(key);
        let blob = row?.blob;
        if (!blob) {
          const file = await source.getFile(photo.id);
          const result = isRawMimeType(photo.mimeType)
            ? await this.rawImage(file, THUMB_SIZE, THUMB_SIZE * 0.66, controller.signal)
            : await this.pool.run({ type: "thumbnail", file, maxSize: THUMB_SIZE }, { signal: controller.signal });
          if (!result) return null;
          blob = result.blob;
          void this.db.thumbs.put({ key, blob, width: result.width, height: result.height, at: Date.now() }).catch(() => undefined);
        }
        const url = URL.createObjectURL(blob);
        this.thumbs.set(key, url);
        return url;
      })().finally(() => {
        if (this.inflight.get(key)?.promise === promise) this.inflight.delete(key);
      });
      entry = { promise, controller, waiters: 0 };
      this.inflight.set(key, entry);
    }
    const shared = entry;
    shared.waiters++;
    signal?.addEventListener(
      "abort",
      () => {
        // Cancel the decode only when nobody else is waiting for it.
        if (--shared.waiters === 0) shared.controller.abort();
      },
      { once: true },
    );
    return shared.promise;
  }

  async imageUrl(photo: PhotoRecord): Promise<string | null> {
    const source = this.library.current();
    if (!source || photo.placeholderHue !== undefined) return null;
    const key = `${source.folder.id}|${photo.id}|${fileKey(photo)}`;
    const cached = this.images.get(key);
    if (cached) return cached;
    const file = await source.getFile(photo.id);
    let blob: Blob = file;
    if (isRawMimeType(photo.mimeType)) {
      const image = await this.rawImage(file, Number.MAX_SAFE_INTEGER, RAW_LOUPE_MIN_PREVIEW);
      if (!image) return null;
      blob = image.blob;
    }
    const url = URL.createObjectURL(blob);
    this.images.set(key, url);
    return url;
  }

  /**
   * A RAW photo as an upright JPEG of at most `maxSize` (long edge): from the
   * embedded preview when it is at least `minPreview` (and covers maxSize, or
   * is the full photo), otherwise from a half-size decode.
   */
  private async rawImage(file: File, maxSize: number, minPreview: number, signal?: AbortSignal) {
    const preview = await this.raw.preview(file).catch(() => null);
    const edge = preview ? Math.max(preview.width, preview.height) : 0;
    if (preview && edge >= minPreview) {
      if (preview.orientation === 1 && edge <= maxSize) return { blob: preview.blob, width: preview.width, height: preview.height };
      return this.pool.run(
        { type: "thumbnail", file: preview.blob, maxSize: Math.min(maxSize, edge), orientation: preview.orientation, quality: 0.9 },
        { signal },
      );
    }
    signal?.throwIfAborted();
    const pixels = await this.raw.decode(file, { half: true }).catch(() => null);
    if (!pixels) return null;
    const bitmap = await createImageBitmap(pixels);
    return this.pool.run({ type: "thumbnail", file: bitmap, maxSize: Math.min(maxSize, Math.max(bitmap.width, bitmap.height)), quality: 0.9 }, { signal });
  }

  async readIndexData(photo: PhotoRecord): Promise<PhotoIndexData | null> {
    const source = this.library.current();
    if (!source || photo.placeholderHue !== undefined) return null;
    const file = await source.getFile(photo.id);
    const exif = this.pool.run({ type: "index", file, mimeType: photo.mimeType ?? file.type }, { lane: "background" });
    if (!isRawMimeType(photo.mimeType)) return exif;
    // RAW: EXIF tags where exifr can read them; the size always from LibRaw (EXIF sizes there often describe a preview).
    const [tags, info] = await Promise.all([exif.catch((): PhotoIndexData => ({})), this.raw.info(file, "background").catch(() => null)]);
    if (!info) return tags;
    const fromRaw: PhotoIndexData["exif"] = {
      make: info.make,
      model: info.model,
      iso: info.iso,
      exposureTime: info.exposureTime,
      aperture: info.aperture,
      focalLength: info.focalLength,
    };
    const exifMerged = Object.fromEntries(
      Object.entries({ ...fromRaw, ...tags.exif }).filter(([, v]) => v !== undefined),
    ) as NonNullable<PhotoIndexData["exif"]>;
    return {
      ...tags,
      width: info.width,
      height: info.height,
      ...(Object.keys(exifMerged).length ? { exif: exifMerged } : {}),
      ...(tags.capturedAt || !info.timestamp ? {} : { capturedAt: localIso(info.timestamp.getTime()) }),
    };
  }

  async decode(photo: PhotoRecord, opts: { maxEdge?: number } = {}): Promise<ImageBitmap | null> {
    if (photo.placeholderHue !== undefined) {
      const full = await sampleImage(photo.placeholderHue, photo.width ?? 1500, photo.height ?? 1000);
      return scaleBitmap(full, opts.maxEdge);
    }
    const source = this.library.current();
    if (!source) return null;
    const file = await source.getFile(photo.id);
    if (isRawMimeType(photo.mimeType)) return this.decodeRaw(photo, file, opts.maxEdge);
    // Oriented according to EXIF ("from-image" is the default).
    const full = await createImageBitmap(file);
    return scaleBitmap(full, opts.maxEdge);
  }

  async readPixels(photo: PhotoRecord, opts: { maxEdge: number }): Promise<PixelData | null> {
    // The cached thumbnail is plenty for analysis and avoids decoding the original. Not for
    // RAW: its thumbnail is the camera's JPEG, with a different tone curve from the decode
    // Develop renders.
    const raw = isRawMimeType(photo.mimeType);
    const url = !raw && opts.maxEdge <= THUMB_SIZE ? await this.thumbnailUrl(photo).catch(() => null) : null;
    const bitmap = url
      ? await createImageBitmap(await (await fetch(url)).blob()).catch(() => null)
      : raw
        ? await this.decodeRawRendered(photo)
        : await this.decode(photo, { maxEdge: opts.maxEdge });
    if (!bitmap) return null;
    const s = Math.min(1, opts.maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * s));
    const height = Math.max(1, Math.round(bitmap.height * s));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return { width, height, data: ctx.getImageData(0, 0, width, height).data };
  }

  /** A RAW photo as Develop renders it (demosaiced, not the embedded preview), at half size. */
  private async decodeRawRendered(photo: PhotoRecord): Promise<ImageBitmap | null> {
    const source = this.library.current();
    if (!source) return null;
    const pixels = await this.raw.decode(await source.getFile(photo.id), { half: true });
    return pixels ? createImageBitmap(pixels) : null;
  }

  private async decodeRaw(photo: PhotoRecord, file: File, maxEdge?: number): Promise<ImageBitmap | null> {
    // Small sizes (edited thumbnails, AI vision): the embedded preview, when it is big enough.
    if (maxEdge && maxEdge <= RAW_SMALL_DECODE) {
      const image = await this.rawImage(file, maxEdge, maxEdge).catch(() => null);
      if (image) return createImageBitmap(image.blob);
    }
    // Half size is plenty when it still covers maxEdge. Until the photo is indexed its size is
    // unknown: ask LibRaw (cheap) rather than decode at full size, which takes ten times longer.
    let longEdge = Math.max(photo.width ?? 0, photo.height ?? 0);
    if (maxEdge && !longEdge) {
      const info = await this.raw.info(file).catch(() => null);
      longEdge = info ? Math.max(info.width, info.height) : 0;
    }
    const half = !!maxEdge && (longEdge === 0 || longEdge / 2 >= maxEdge);
    const pixels = await this.raw.decode(file, { half });
    if (!pixels) return null;
    return scaleBitmap(await createImageBitmap(pixels), maxEdge);
  }

  reset(): void {
    this.pool.clear();
    this.raw.dispose();
    for (const entry of this.inflight.values()) entry.controller.abort();
    this.inflight.clear();
    this.thumbs.clear();
    this.images.clear();
  }
}

/** For tests and non-browser runtimes: no previews, no index data. */
export class NullPreviewService implements PreviewService {
  async thumbnailUrl(_photo: PhotoRecord, _signal?: AbortSignal): Promise<string | null> {
    return null;
  }
  async imageUrl(_photo: PhotoRecord): Promise<string | null> {
    return null;
  }
  async readIndexData(_photo: PhotoRecord): Promise<PhotoIndexData | null> {
    return null;
  }
  async decode(_photo: PhotoRecord, _opts?: { maxEdge?: number }): Promise<ImageBitmap | null> {
    return null;
  }
  async readPixels(_photo: PhotoRecord, _opts: { maxEdge: number }): Promise<PixelData | null> {
    return null;
  }
  reset(): void {}
}

async function scaleBitmap(bitmap: ImageBitmap, maxEdge?: number): Promise<ImageBitmap> {
  if (!maxEdge || Math.max(bitmap.width, bitmap.height) <= maxEdge) return bitmap;
  const s = maxEdge / Math.max(bitmap.width, bitmap.height);
  const scaled = await createImageBitmap(bitmap, {
    resizeWidth: Math.max(1, Math.round(bitmap.width * s)),
    resizeHeight: Math.max(1, Math.round(bitmap.height * s)),
    resizeQuality: "high",
  });
  bitmap.close();
  return scaled;
}
