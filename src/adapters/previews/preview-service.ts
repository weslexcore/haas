import { fileKey } from "../../core/library/util";
import type { LibraryProvider, PhotoIndexData, PreviewService } from "../../core/services";
import type { PhotoRecord } from "../../core/state/types";
import type { PhotoDB } from "../db";
import { WorkerPool } from "./worker-pool";
import { sampleImage } from "../sample-image";

const THUMB_SIZE = 480;
const MAX_THUMB_URLS = 1200;
const MAX_IMAGE_URLS = 5;

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
  ) {
    this.pool =
      pool ?? new WorkerPool(() => new Worker(new URL("./preview.worker.ts", import.meta.url), { type: "module" }));
  }

  async thumbnailUrl(photo: PhotoRecord, signal?: AbortSignal): Promise<string | null> {
    const source = this.library.current();
    if (!source || photo.placeholderHue !== undefined) return null;
    const key = `${source.folder.id}|${photo.id}|${fileKey(photo)}`;
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
          const result = await this.pool.run({ type: "thumbnail", file, maxSize: THUMB_SIZE }, { signal: controller.signal });
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
    const url = URL.createObjectURL(await source.getFile(photo.id));
    this.images.set(key, url);
    return url;
  }

  async readIndexData(photo: PhotoRecord): Promise<PhotoIndexData | null> {
    const source = this.library.current();
    if (!source || photo.placeholderHue !== undefined) return null;
    const file = await source.getFile(photo.id);
    return this.pool.run({ type: "index", file, mimeType: photo.mimeType ?? file.type }, { lane: "background" });
  }

  async decode(photo: PhotoRecord, opts: { maxEdge?: number } = {}): Promise<ImageBitmap | null> {
    if (photo.placeholderHue !== undefined) {
      const full = await sampleImage(photo.placeholderHue, photo.width ?? 1500, photo.height ?? 1000);
      return scaleBitmap(full, opts.maxEdge);
    }
    const source = this.library.current();
    if (!source) return null;
    // Oriented according to EXIF ("from-image" is the default).
    const full = await createImageBitmap(await source.getFile(photo.id));
    return scaleBitmap(full, opts.maxEdge);
  }

  reset(): void {
    this.pool.clear();
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
