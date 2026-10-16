import type { AppContext } from "../actions/types";
import { selectVisibleIds } from "../state/selectors";
import { indexPhotos } from "./indexer";
import { buildRecords } from "./load";

const numeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function currentSource(ctx: AppContext) {
  const source = ctx.services.library.current();
  const folder = ctx.state.library.folder;
  if (!source || !folder || source.folder.id !== folder.id) throw new Error("No folder is open.");
  if (!folder.writable) throw new Error(`“${folder.name}” was opened read-only, so photos can't be moved.`);
  return source;
}

/**
 * Move photos (with sidecars) into the folder's _Rejected subfolder and drop
 * them from the library. Reversible with restorePhotos until the trash is emptied.
 */
export async function removePhotos(ctx: AppContext, ids: string[]) {
  const source = currentSource(ctx);
  if (!ids.length) return { removed: 0, failed: [] as Array<{ path: string; error: string }> };
  // Pending sidecar writes must land before the files move, or they'd recreate sidecars in place.
  await ctx.services.persistence.flush();

  const visibleBefore = selectVisibleIds(ctx.state);
  const { done, failed } = await source.moveToTrash(ids);
  const gone = new Set(done);
  // Undo entries can refer to removed photos; restoring is the way back.
  ctx.historyControl.clear();
  ctx.update((s) => {
    s.photos.order = s.photos.order.filter((id) => !gone.has(id));
    for (const id of gone) delete s.photos.byId[id];
    s.library.removedCount += gone.size;
    const ids = s.selection.ids.filter((id) => !gone.has(id));
    let active = s.selection.activeId && !gone.has(s.selection.activeId) ? s.selection.activeId : null;
    if (!active) {
      // Like culling: land on the next remaining photo after the first removed one.
      const start = Math.max(0, visibleBefore.findIndex((id) => gone.has(id)));
      active = [...visibleBefore.slice(start), ...visibleBefore.slice(0, start).reverse()].find((id) => !gone.has(id)) ?? null;
    }
    s.selection = { activeId: active, ids: ids.length ? ids : active ? [active] : [] };
  });
  return { removed: done.length, failed };
}

/** Move photos back from the _Rejected subfolder (all of them if no paths are given). */
export async function restorePhotos(ctx: AppContext, paths?: string[]) {
  const source = currentSource(ctx);
  const { done, failed } = await source.restoreFromTrash(paths);
  const records = await buildRecords(ctx, source, done);
  ctx.update((s) => {
    for (const r of records) s.photos.byId[r.id] = r;
    s.photos.order = [...new Set([...s.photos.order, ...records.map((r) => r.id)])].sort(numeric);
    s.library.removedCount = Math.max(0, s.library.removedCount - records.length);
    if (records.length) s.selection = { activeId: records[0]!.id, ids: records.map((r) => r.id) };
  });
  const unindexed = records.filter((r) => !r.indexed).map((r) => r.id);
  if (unindexed.length) void indexPhotos(ctx, source.folder.id, unindexed);
  return { restored: records.length, failed };
}

/** Permanently delete everything in the _Rejected subfolder. */
export async function emptyTrash(ctx: AppContext) {
  const source = currentSource(ctx);
  const trashed = await source.listTrash();
  const deleted = await source.emptyTrash();
  await ctx.services.metadata.remove(source.folder.id, trashed.map((f) => f.path)).catch(() => undefined);
  ctx.update((s) => {
    s.library.removedCount = 0;
  });
  return { deleted };
}
