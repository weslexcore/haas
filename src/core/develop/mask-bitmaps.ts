import type { SegmentationService } from "../services";
import type { PhotoRecord } from "../state/types";
import { segmentMasks, type MaskBitmaps } from "./masks";
import type { EditRecipe } from "./recipe";

/**
 * The bitmaps a recipe's segment masks need to render, by mask id, from the
 * segmentation service (cached there per photo). With `lenient`, a mask
 * whose detection fails is left out (it then covers nothing) instead of
 * failing the whole call: right for previews and thumbnails, not for export.
 */
export async function collectMaskBitmaps(
  segmentation: SegmentationService,
  photo: PhotoRecord,
  recipe: EditRecipe | undefined,
  opts: { lenient?: boolean } = {},
): Promise<MaskBitmaps> {
  const out: MaskBitmaps = {};
  const masks = segmentMasks(recipe?.masks);
  if (!masks.length) return out;
  const results = await Promise.all(
    masks.map(async (m) => {
      try {
        return [m.id, await segmentation.segment(photo, m.shape.target)] as const;
      } catch (e) {
        if (opts.lenient) return null;
        throw e;
      }
    }),
  );
  for (const r of results) if (r) out[r[0]] = r[1];
  return out;
}

/** Whether `recipe` has any segment masks (so its render needs bitmaps). */
export function needsMaskBitmaps(recipe: EditRecipe | undefined): boolean {
  return segmentMasks(recipe?.masks).length > 0;
}
