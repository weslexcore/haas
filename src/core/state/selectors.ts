import type { AppState, LibraryFilter, LibrarySort, PhotoRecord } from "./types";

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
  order: string[];
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
  const { order, byId } = state.photos;
  const { filter, sort } = state.library;
  if (cache && cache.order === order && cache.byId === byId && cache.filter === filter && cache.sort === sort) {
    return cache.result;
  }
  const result = order
    .map((id) => byId[id]!)
    .filter((p) => matchesFilter(p, filter))
    .sort((a, b) => compare(a, b, sort))
    .map((p) => p.id);
  cache = { order, byId, filter, sort, result };
  return result;
}

export function activePhoto(state: AppState): PhotoRecord | undefined {
  return state.selection.activeId ? state.photos.byId[state.selection.activeId] : undefined;
}
