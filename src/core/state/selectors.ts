import { pairRawWithJpeg } from "../library/formats";
import type { AppState, LibraryFilter, LibrarySort, PhotoRecord } from "./types";

export interface RawJpegPairs {
  /** Each paired RAW's JPEG. */
  jpegByRaw: Map<string, string>;
  /** Each paired JPEG's RAW. */
  rawByJpeg: Map<string, string>;
}

let pairsCache: { order: string[]; result: RawJpegPairs } | null = null;

/** RAW+JPEG pairs among the loaded files (by path, so only the load order matters). */
export function selectPairs(state: AppState): RawJpegPairs {
  const { order } = state.photos;
  if (pairsCache && pairsCache.order === order) return pairsCache.result;
  const { companions } = pairRawWithJpeg(order);
  const result: RawJpegPairs = { jpegByRaw: companions, rawByJpeg: new Map([...companions].map(([raw, jpeg]) => [jpeg, raw])) };
  pairsCache = { order, result };
  return result;
}

let libraryCache: { order: string[]; grouped: boolean; result: string[] } | null = null;

/**
 * The photos the library holds, in load order: every file, minus the JPEG of
 * each RAW+JPEG pair while pairs are grouped.
 */
export function selectLibraryIds(state: AppState): string[] {
  const { order } = state.photos;
  const grouped = state.library.groupRawJpeg;
  if (libraryCache && libraryCache.order === order && libraryCache.grouped === grouped) return libraryCache.result;
  const { rawByJpeg } = selectPairs(state);
  const result = grouped && rawByJpeg.size ? order.filter((id) => !rawByJpeg.has(id)) : order;
  libraryCache = { order, grouped, result };
  return result;
}

/** The JPEG that travels with this RAW while pairs are grouped (shown as "+JPG"; removed with it). */
export function companionOf(state: AppState, id: string): string | undefined {
  return state.library.groupRawJpeg ? selectPairs(state).jpegByRaw.get(id) : undefined;
}

/**
 * The file shown for a photo in thumbnails and Loupe: a grouped RAW shows its
 * camera JPEG (full size, as the camera rendered it) instead of the RAW's
 * embedded preview. Develop and export still work from the RAW.
 */
export function displayedRecord(state: AppState, photo: PhotoRecord): PhotoRecord {
  const jpeg = companionOf(state, photo.id);
  return (jpeg && state.photos.byId[jpeg]) || photo;
}

export function matchesFilter(p: PhotoRecord, f: LibraryFilter): boolean {
  if (p.rating < f.minRating) return false;
  if (f.flags.length && !f.flags.includes(p.flag)) return false;
  if (f.colorLabels.length && !f.colorLabels.includes(p.colorLabel)) return false;
  if (f.text && !p.id.toLowerCase().includes(f.text.toLowerCase())) return false;
  return true;
}

export function isFilterActive(f: LibraryFilter): boolean {
  return f.minRating > 0 || f.flags.length > 0 || f.colorLabels.length > 0 || f.text !== "";
}

function compare(a: PhotoRecord, b: PhotoRecord, sort: LibrarySort): number {
  let d = 0;
  switch (sort.key) {
    case "capturedAt":
      d = a.capturedAt.localeCompare(b.capturedAt);
      break;
    case "fileName":
      d = a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
      break;
    case "rating":
      d = a.rating - b.rating;
      break;
    case "size":
      d = (a.size ?? 0) - (b.size ?? 0);
      break;
  }
  // Stable tie-break on path so order never jitters.
  if (d === 0) d = a.id.localeCompare(b.id, undefined, { numeric: true });
  return sort.direction === "asc" ? d : -d;
}

let cache: {
  ids: string[];
  byId: Record<string, PhotoRecord>;
  filter: LibraryFilter;
  sort: LibrarySort;
  result: string[];
} | null = null;

/**
 * Photos in display order after filtering and sorting. Memoized on the
 * (structurally shared) inputs, so it is cheap to call from actions and UI.
 */
export function selectVisibleIds(state: AppState): string[] {
  const ids = selectLibraryIds(state);
  const { byId } = state.photos;
  const { filter, sort } = state.library;
  if (cache && cache.ids === ids && cache.byId === byId && cache.filter === filter && cache.sort === sort) {
    return cache.result;
  }
  const result = ids
    .map((id) => byId[id]!)
    .filter((p) => matchesFilter(p, filter))
    .sort((a, b) => compare(a, b, sort))
    .map((p) => p.id);
  cache = { ids, byId, filter, sort, result };
  return result;
}

export function activePhoto(state: AppState): PhotoRecord | undefined {
  return state.selection.activeId ? state.photos.byId[state.selection.activeId] : undefined;
}
