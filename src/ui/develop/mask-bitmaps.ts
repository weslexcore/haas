import { useEffect, useState, useSyncExternalStore } from "react";
import { segmentMasks, type MaskBitmaps } from "../../core/develop/masks";
import type { EditRecipe } from "../../core/develop/recipe";
import { fileKey } from "../../core/library/util";
import type { PhotoRecord } from "../../core/state/types";
import { useRuntime } from "../runtime-context";

export interface MaskBitmapState {
  /** Bitmaps by mask id, as they arrive. */
  bitmaps: MaskBitmaps;
  /** Segment masks still being detected. */
  pending: string[];
  /** Segment masks whose detection failed, with the reason. */
  errors: Record<string, string>;
}

const EMPTY: MaskBitmapState = { bitmaps: {}, pending: [], errors: {} };

/**
 * The bitmaps of a recipe's segment masks for the photo, from the
 * segmentation service (which caches them per photo). Re-requests when a
 * mask's target or the photo's file changes; other edits leave it alone.
 */
export function useMaskBitmaps(photo: PhotoRecord, recipe: EditRecipe | undefined): MaskBitmapState {
  const { services } = useRuntime();
  const segs = segmentMasks(recipe?.masks);
  const key = `${photo.id}|${fileKey(photo)}|${segs.map((m) => `${m.id}:${m.shape.target}`).join(",")}`;
  const [state, setState] = useState<MaskBitmapState & { key: string }>({ ...EMPTY, key });

  useEffect(() => {
    if (!segs.length) {
      setState({ ...EMPTY, key });
      return;
    }
    let live = true;
    // Keep what is already known for masks that are unchanged, so adding a second mask doesn't blank the first.
    setState((s) => {
      const keep: MaskBitmaps = {};
      const samePhoto = s.key.split("|").slice(0, 2).join("|") === key.split("|").slice(0, 2).join("|");
      if (samePhoto) for (const m of segs) if (s.bitmaps[m.id]) keep[m.id] = s.bitmaps[m.id]!;
      return { key, bitmaps: keep, pending: segs.filter((m) => !keep[m.id]).map((m) => m.id), errors: {} };
    });
    for (const m of segs) {
      services.segmentation
        .segment(photo, m.shape.target)
        .then((bitmap) => {
          if (!live) return;
          setState((s) => (s.key === key ? { ...s, bitmaps: { ...s.bitmaps, [m.id]: bitmap }, pending: s.pending.filter((id) => id !== m.id) } : s));
        })
        .catch((e: unknown) => {
          if (!live) return;
          const message = e instanceof Error ? e.message : String(e);
          setState((s) => (s.key === key ? { ...s, pending: s.pending.filter((id) => id !== m.id), errors: { ...s.errors, [m.id]: message } } : s));
        });
    }
    return () => {
      live = false;
    };
    // The key covers the photo's file and every segment mask's id and target.
  }, [key, services]);

  return state.key === key ? state : EMPTY;
}

/** Progress of the segmentation model download, or null. */
export function useSegmentationLoading(): { loaded: number; total: number } | null {
  const { services } = useRuntime();
  return useSyncExternalStore(
    (cb) => services.segmentation.onLoading(cb),
    () => services.segmentation.loading,
  );
}
