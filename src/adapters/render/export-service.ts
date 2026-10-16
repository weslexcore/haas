import { fitWithin } from "../../core/develop/crop";
import type { EditRecipe } from "../../core/develop/recipe";
import type { ExportService } from "../../core/services";
import type { ExportRequest, ExportResponse } from "./export.worker";
import { WebGL2Renderer } from "./webgl2-renderer";

/**
 * Renders exports in a worker (OffscreenCanvas + WebGL2), one at a time.
 * Falls back to the main thread where workers can't use WebGL2.
 */
export class WorkerExportService implements ExportService {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: { blob: Blob; width: number; height: number }) => void; reject: (e: Error) => void }>();
  private queue: Promise<unknown> = Promise.resolve();

  renderJpeg(image: ImageBitmap, recipe: EditRecipe, opts: { quality: number; maxEdge?: number }) {
    const run = () => (this.canUseWorker() ? this.inWorker(image, recipe, opts) : renderOnMainThread(image, recipe, opts));
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private canUseWorker(): boolean {
    return typeof OffscreenCanvas !== "undefined" && typeof Worker !== "undefined";
  }

  private inWorker(image: ImageBitmap, recipe: EditRecipe, opts: { quality: number; maxEdge?: number }) {
    if (!this.worker) {
      this.worker = new Worker(new URL("./export.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<ExportResponse>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.ok) p.resolve({ blob: e.data.blob, width: e.data.width, height: e.data.height });
        else p.reject(new Error(e.data.error));
      };
    }
    const id = this.nextId++;
    return new Promise<{ blob: Blob; width: number; height: number }>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg: ExportRequest = { id, image, recipe, quality: opts.quality, ...(opts.maxEdge ? { maxEdge: opts.maxEdge } : {}) };
      // Copied, not transferred, so the main-thread fallback can still use it.
      this.worker!.postMessage(msg);
    }).catch(async (error: Error) => {
      // e.g. no WebGL2 in workers on this browser: retry on the main thread once.
      if (/WebGL2/.test(error.message)) return renderOnMainThread(image, recipe, opts);
      throw error;
    });
  }
}

async function renderOnMainThread(image: ImageBitmap, recipe: EditRecipe, opts: { quality: number; maxEdge?: number }) {
  const canvas = document.createElement("canvas");
  const renderer = new WebGL2Renderer(canvas);
  try {
    renderer.setSource(image, { width: image.width, height: image.height });
    const full = renderer.outputSize(recipe);
    const size = opts.maxEdge ? fitWithin(full, opts.maxEdge) : full;
    renderer.render(recipe, size);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("JPEG encoding failed"))), "image/jpeg", opts.quality),
    );
    return { blob, ...size };
  } finally {
    renderer.dispose();
  }
}
