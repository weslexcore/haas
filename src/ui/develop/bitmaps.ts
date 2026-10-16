import { fileKey } from "../../core/library/util";
import type { PreviewService } from "../../core/services";
import type { PhotoRecord } from "../../core/state/types";

/** Long edge for the interactive preview: sharp on large screens, fast to render. */
export const PREVIEW_EDGE = 2560;

const MAX = 4;
const cache = new Map<string, Promise<ImageBitmap | null>>();

/** Decoded, oriented bitmaps for editing, with a small LRU (current photo and neighbours). */
export function editingBitmap(previews: PreviewService, photo: PhotoRecord, maxEdge?: number): Promise<ImageBitmap | null> {
  const key = `${photo.id}|${fileKey(photo)}|${maxEdge ?? "full"}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const p = previews.decode(photo, maxEdge ? { maxEdge } : {}).catch(() => null);
  cache.set(key, p);
  while (cache.size > MAX) {
    const [oldKey, old] = cache.entries().next().value!;
    cache.delete(oldKey);
    void old.then((b) => b?.close());
  }
  return p;
}

export function clearEditingBitmaps(): void {
  for (const p of cache.values()) void p.then((b) => b?.close());
  cache.clear();
}
