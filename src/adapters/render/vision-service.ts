import { fitWithin } from "../../core/develop/crop";
import { collectMaskBitmaps } from "../../core/develop/mask-bitmaps";
import type { CapturedImage, PreviewService, SegmentationService, VisionService } from "../../core/services";
import type { PhotoRecord } from "../../core/state/types";
import { WebGL2Renderer } from "./webgl2-renderer";

/**
 * Renders photos for the AI to look at: decoded (oriented), optionally with
 * the develop edits applied on the GPU, scaled, and encoded as JPEG.
 */
export class BrowserVisionService implements VisionService {
  private renderer: WebGL2Renderer | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly previews: PreviewService,
    private readonly segmentation?: SegmentationService,
  ) {}

  capture(photo: PhotoRecord, opts: { maxEdge: number; edited: boolean }): Promise<CapturedImage> {
    const run = async () => {
      // Decode a little larger than needed so crops still have enough pixels.
      const bitmap = await this.previews.decode(photo, { maxEdge: Math.max(opts.maxEdge * 2, 1024) });
      if (!bitmap) throw new Error(`Can't decode ${photo.fileName} in this browser.`);
      const edited = opts.edited && !!photo.edit;
      const canvas = document.createElement("canvas");
      if (edited) {
        // A segment mask whose detection fails is shown without its effect, rather than failing the look.
        const bitmaps = this.segmentation ? await collectMaskBitmaps(this.segmentation, photo, photo.edit, { lenient: true }) : {};
        this.renderer ??= new WebGL2Renderer(document.createElement("canvas"));
        this.renderer.setSource(bitmap, { width: bitmap.width, height: bitmap.height });
        this.renderer.setMaskBitmaps(bitmaps);
        const size = fitWithin(this.renderer.outputSize(photo.edit!), opts.maxEdge);
        this.renderer.render(photo.edit!, size);
        canvas.width = size.width;
        canvas.height = size.height;
        canvas.getContext("2d")!.drawImage(this.renderer.canvas as HTMLCanvasElement, 0, 0);
      } else {
        const size = fitWithin({ width: bitmap.width, height: bitmap.height }, opts.maxEdge);
        canvas.width = size.width;
        canvas.height = size.height;
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0, size.width, size.height);
      }
      bitmap.close();
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("JPEG encoding failed"))), "image/jpeg", 0.85),
      );
      const data = await toBase64(blob);
      return { photoId: photo.id, mediaType: "image/jpeg" as const, data, width: canvas.width, height: canvas.height, edited };
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
