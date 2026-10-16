import type { AppContext } from "../actions/types";
import type { PhotoIndexData } from "../services";
import { fileKey } from "./util";

export const INDEX_APPLY_ACTION = "library.index.apply";

const CONCURRENCY = 6;
const BATCH_SIZE = 64;
const BATCH_MS = 400;

export interface IndexUpdate extends PhotoIndexData {
  id: string;
}

/**
 * Read EXIF for photos in the background and apply results in batches via
 * an internal action. Stops quietly if the folder changes mid-way.
 */
export async function indexPhotos(ctx: AppContext, folderId: string, ids: string[]): Promise<void> {
  const total = ids.length;
  let done = 0;
  let pending: IndexUpdate[] = [];
  let lastFlush = Date.now();
  let next = 0;
  const stillCurrent = () => ctx.state.library.folder?.id === folderId;

  const flush = async () => {
    if (!pending.length || !stillCurrent()) return;
    const batch = pending;
    pending = [];
    lastFlush = Date.now();
    await ctx.dispatch(INDEX_APPLY_ACTION, { updates: batch, done, total });
    const byId = ctx.state.photos.byId;
    await ctx.services.metadata
      .save(
        folderId,
        batch.map(({ id, ...data }) => ({ path: id, fileKey: fileKey(byId[id] ?? {}), ...data })),
      )
      .catch(() => undefined);
  };

  const worker = async () => {
    while (next < ids.length && stillCurrent()) {
      const id = ids[next++]!;
      const photo = ctx.state.photos.byId[id];
      const data = photo ? await ctx.services.previews.readIndexData(photo).catch(() => null) : null;
      done++;
      pending.push({ id, ...(data ?? {}) });
      if (pending.length >= BATCH_SIZE || Date.now() - lastFlush > BATCH_MS) await flush();
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  await flush();
}
