import { INTERACTIVE_SOURCES, type AppContext, type ReadonlyContext } from "../core/actions/types";
import { isFilterActive, selectVisibleIds } from "../core/state/selectors";
import type { AppState, PhotoRecord } from "../core/state/types";

export function contextSummary(ctx: ReadonlyContext) {
  const { state } = ctx;
  const active = state.selection.activeId ? state.photos.byId[state.selection.activeId] : undefined;
  return {
    view: state.view,
    theme: state.theme,
    folder: state.library.folder,
    libraryStatus: state.library.status,
    photoCount: state.photos.order.length,
    visibleCount: selectVisibleIds(state).length,
    filter: isFilterActive(state.library.filter) ? state.library.filter : null,
    sort: state.library.sort,
    selectionCount: state.selection.ids.length,
    activePhoto: active ? publicPhoto(active) : null,
    autoAdvance: state.autoAdvance,
    capsLock: ctx.input.capsLock,
    canUndo: ctx.history.canUndo,
    canRedo: ctx.history.canRedo,
  };
}

export function publicPhoto(p: PhotoRecord) {
  return {
    id: p.id,
    fileName: p.fileName,
    capturedAt: p.capturedAt,
    rating: p.rating,
    flag: p.flag,
    colorLabel: p.colorLabel,
    ...(p.width ? { width: p.width, height: p.height } : {}),
    ...(p.exif ? { exif: p.exif } : {}),
  };
}

/** Photo ids a library command should act on: explicit ids, else the selection. */
export function targetIds(state: AppState, photoIds: string[] | undefined): string[] {
  const ids = photoIds ?? state.selection.ids;
  const unknown = ids.filter((id) => !state.photos.byId[id]);
  if (unknown.length) throw new Error(`Unknown photo ids: ${unknown.slice(0, 5).join(", ")}`);
  return ids;
}

/**
 * Auto-advance after a culling command. Explicit `advance` wins. Otherwise it
 * follows the user's setting, and only for interactive input on a single
 * photo, so AI plans and scripts never jump around unless they ask to.
 */
export async function maybeAdvance(ctx: AppContext, advance: boolean | undefined, singlePhoto: boolean): Promise<boolean> {
  const mode = ctx.state.autoAdvance;
  const interactive = INTERACTIVE_SOURCES.includes(ctx.source);
  const should = advance ?? (interactive && singlePhoto && (mode === "always" || (mode === "capsLock" && ctx.input.capsLock)));
  if (!should) return false;
  const result = await ctx.dispatch("navigation.next");
  return result.ok;
}
