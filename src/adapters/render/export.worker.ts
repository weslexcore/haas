/// <reference lib="webworker" />
import { fitWithin } from "../../core/develop/crop";
import type { MaskBitmaps } from "../../core/develop/masks";
import type { EditRecipe } from "../../core/develop/recipe";
import { WebGL2Renderer } from "./webgl2-renderer";

export interface ExportRequest {
  id: number;
  image: ImageBitmap;
  recipe: EditRecipe;
  quality: number;
  maxEdge?: number;
  /** Bitmaps for the recipe's segment masks. */
  maskBitmaps?: MaskBitmaps;
}

export type ExportResponse =
  | { id: number; ok: true; blob: Blob; width: number; height: number }
  | { id: number; ok: false; error: string };

let renderer: WebGL2Renderer | null = null;

/** Full-resolution render of the edit to JPEG, off the main thread. */
self.onmessage = async (e: MessageEvent<ExportRequest>) => {
  const { id, image, recipe, quality, maxEdge, maskBitmaps } = e.data;
  try {
    renderer ??= new WebGL2Renderer(new OffscreenCanvas(1, 1));
    renderer.setSource(image, { width: image.width, height: image.height });
    image.close(); // our copy
    renderer.setMaskBitmaps(maskBitmaps ?? {});
    const full = renderer.outputSize(recipe);
    const size = maxEdge ? fitWithin(full, maxEdge) : full;
    renderer.render(recipe, size);
    const blob = await (renderer.canvas as OffscreenCanvas).convertToBlob({ type: "image/jpeg", quality });
    self.postMessage({ id, ok: true, blob, width: size.width, height: size.height } satisfies ExportResponse);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies ExportResponse);
  }
};
