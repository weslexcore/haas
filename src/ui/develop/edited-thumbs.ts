import { WebGL2Renderer } from "../../adapters/render/webgl2-renderer";
import { fitWithin } from "../../core/develop/crop";
import type { EditRecipe } from "../../core/develop/recipe";
import type { PreviewService } from "../../core/services";
import type { PhotoRecord } from "../../core/state/types";

/**
 * Edited thumbnails: the cached thumbnail run through the develop pipeline on
 * one shared WebGL2 context, serialized, and cached by (photo, recipe).
 */
const THUMB_EDGE = 480;
const MAX_URLS = 400;

let renderer: WebGL2Renderer | null = null;
let queue: Promise<unknown> = Promise.resolve();
const urls = new Map<string, Promise<string | null>>();

function shared(): WebGL2Renderer {
  renderer ??= new WebGL2Renderer(document.createElement("canvas"));
  return renderer;
}

export function editedThumbKey(photo: PhotoRecord, recipe: EditRecipe): string {
  return `${photo.id}|${photo.lastModified ?? 0}|${JSON.stringify(recipe)}`;
}

/** Object URL of the photo's thumbnail with `recipe` applied (null if it can't be made). */
export function editedThumbnailUrl(previews: PreviewService, photo: PhotoRecord, recipe: EditRecipe, baseUrl: string | null): Promise<string | null> {
  const key = editedThumbKey(photo, recipe);
  const hit = urls.get(key);
  if (hit) return hit;
  const job = queue.then(async () => {
    const bitmap = baseUrl
      ? await createImageBitmap(await (await fetch(baseUrl)).blob())
      : await previews.decode(photo, { maxEdge: THUMB_EDGE });
    if (!bitmap) return null;
    const r = shared();
    r.setSource(bitmap, { width: bitmap.width, height: bitmap.height });
    bitmap.close();
    r.render(recipe, fitWithin(r.outputSize(recipe), THUMB_EDGE));
    const canvas = r.canvas as HTMLCanvasElement;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? URL.createObjectURL(blob) : null;
  });
  const result = job.catch(() => null);
  queue = result;
  urls.set(key, result);
  while (urls.size > MAX_URLS) {
    const [oldKey, old] = urls.entries().next().value!;
    urls.delete(oldKey);
    void old.then((u) => u && URL.revokeObjectURL(u));
  }
  return result;
}
