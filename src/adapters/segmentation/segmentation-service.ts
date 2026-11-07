import type { MaskBitmap } from "../../core/develop/masks";
import type { SegmentTarget } from "../../core/develop/recipe";
import { fileKey } from "../../core/library/util";
import type { PreviewService, SegmentationService } from "../../core/services";
import type { PhotoRecord } from "../../core/state/types";
import { INPUT, type SegmentRequest, type SegmentResponse } from "./segment.worker";

const MAX_CACHED = 32;

/**
 * Segment masks from a model in a worker (segment.worker.ts). One inference
 * per photo gives every target's mask; they are cached by photo (and file
 * version) so switching a mask's target, or rendering the same photo for
 * export, thumbnails and the AI, never runs the model again.
 */
export class BrowserSegmentationService implements SegmentationService {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (m: Record<SegmentTarget, MaskBitmap>) => void; reject: (e: Error) => void }>();
  private cache = new Map<string, Promise<Record<SegmentTarget, MaskBitmap>>>();
  private listeners = new Set<() => void>();
  loading: { loaded: number; total: number } | null = null;

  constructor(private readonly previews: PreviewService) {}

  onLoading(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  async segment(photo: PhotoRecord, target: SegmentTarget): Promise<MaskBitmap> {
    const key = `${photo.id}|${fileKey(photo)}`;
    let all = this.cache.get(key);
    if (!all) {
      all = this.segmentAll(photo);
      this.cache.set(key, all);
      all.catch(() => this.cache.delete(key)); // try again next time
      while (this.cache.size > MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
    }
    return (await all)[target];
  }

  private async segmentAll(photo: PhotoRecord): Promise<Record<SegmentTarget, MaskBitmap>> {
    if (typeof Worker === "undefined") throw new Error("Segment masks need web workers, which this browser doesn't provide.");
    // Decode a little larger than the model input, then stretch to a square: the mask comes back in the photo's uv.
    const bitmap = await this.previews.decode(photo, { maxEdge: INPUT * 2 });
    if (!bitmap) throw new Error("Can't decode this photo for segmentation.");
    const canvas = new OffscreenCanvas(INPUT, INPUT);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, INPUT, INPUT);
    bitmap.close();
    const pixels = ctx.getImageData(0, 0, INPUT, INPUT).data;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg: SegmentRequest = { id, pixels };
      this.ensureWorker().postMessage(msg, [pixels.buffer]);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("./segment.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<SegmentResponse>) => {
      const msg = e.data;
      if (msg.kind === "progress") {
        this.loading = msg.total && msg.loaded >= msg.total ? null : { loaded: msg.loaded, total: msg.total };
        for (const l of this.listeners) l();
        return;
      }
      if (this.loading) {
        this.loading = null;
        for (const l of this.listeners) l();
      }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.masks);
      else p.reject(new Error(msg.error));
    };
    this.worker.onerror = (e) => {
      const error = new Error(e.message || "The segmentation worker failed to start.");
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    return this.worker;
  }
}

/** For tests and non-browser runtimes: no model. */
export class NullSegmentationService implements SegmentationService {
  loading = null;
  onLoading(): () => void {
    return () => undefined;
  }
  async segment(): Promise<MaskBitmap> {
    throw new Error("Segmentation isn't available here.");
  }
}
