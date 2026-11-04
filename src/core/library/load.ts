import type { AppContext } from "../actions/types";
import type { PhotoSource, SourceFile, StoredPhotoMeta } from "../services";
import { selectVisibleIds } from "../state/selectors";
import { defaultFilter, type PhotoRecord } from "../state/types";
import { parseXmp, type XmpCulling } from "../xmp/xmp";
import { isDefaultRecipe, recipeSchema, type EditRecipe } from "../develop/recipe";

function storedEdit(stored: StoredPhotoMeta | undefined): EditRecipe | undefined {
  if (!stored?.edit) return undefined;
  const parsed = recipeSchema.safeParse(stored.edit);
  return parsed.success ? parsed.data : undefined;
}
import { indexPhotos } from "./indexer";
import { fileKey, localIso } from "./util";

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function buildRecord(
  f: SourceFile,
  stored: StoredPhotoMeta | undefined,
  sidecar: { text: string; lastModified: number } | null,
): PhotoRecord {
  const cached = stored?.fileKey === fileKey(f) ? stored : undefined;
  let culling: XmpCulling = {
    rating: stored?.rating ?? 0,
    flag: stored?.flag ?? "none",
    colorLabel: stored?.colorLabel ?? "none",
    edit: storedEdit(stored),
  };
  // A sidecar edited after our last save (e.g. in Lightroom or darktable) wins.
  if (sidecar && (!stored || sidecar.lastModified > stored.savedAt)) {
    try {
      culling = { ...culling, ...parseXmp(sidecar.text) };
    } catch {
      // Unreadable sidecar: keep stored values; the sidecar is left untouched.
    }
  }
  const { edit, ...rest } = culling;
  const record: PhotoRecord = {
    id: f.path,
    fileName: f.name,
    size: f.size,
    lastModified: f.lastModified,
    mimeType: f.mimeType,
    ...(f.companion ? { companion: f.companion } : {}),
    capturedAt: cached?.capturedAt ?? localIso(f.lastModified),
    indexed: !!cached,
    ...rest,
  };
  if (edit && !isDefaultRecipe(edit)) record.edit = edit;
  if (cached?.width) record.width = cached.width;
  if (cached?.height) record.height = cached.height;
  if (cached?.exif) record.exif = cached.exif;
  if (f.sample) {
    record.placeholderHue = f.sample.hue;
    record.capturedAt = f.sample.capturedAt;
    record.width = f.sample.width;
    record.height = f.sample.height;
    record.indexed = true;
  }
  return record;
}

/** Photo records for files, with culling metadata from app storage and sidecars. */
export async function buildRecords(ctx: AppContext, source: PhotoSource, files: SourceFile[]): Promise<PhotoRecord[]> {
  const stored = await ctx.services.metadata.load(source.folder.id);
  const sidecars = await mapLimit(files, 16, (f) => source.readSidecar(f.path).catch(() => null));
  return files.map((f, i) => buildRecord(f, stored.get(f.path), sidecars[i] ?? null));
}

/**
 * Replace the library with the contents of `source`: list files, restore
 * stored and sidecar metadata, then index EXIF in the background.
 */
export async function loadSource(ctx: AppContext, source: PhotoSource): Promise<{ count: number }> {
  const { folder } = source;
  ctx.services.previews.reset();
  ctx.historyControl.clear(); // undo entries refer to the previous folder's photos
  ctx.update((s) => {
    s.library.folder = folder;
    s.library.status = { kind: "loading", message: `Reading ${folder.name}…` };
    s.library.filter = defaultFilter;
    s.photos = { order: [], byId: {} };
    s.selection = { activeId: null, ids: [] };
  });

  try {
    const [files, trashed] = await Promise.all([source.listFiles(), source.listTrash().catch(() => [])]);
    const records = await buildRecords(ctx, source, files);
    const unindexed = records.filter((r) => !r.indexed).map((r) => r.id);

    ctx.update((s) => {
      s.photos = {
        order: records.map((r) => r.id),
        byId: Object.fromEntries(records.map((r) => [r.id, r])),
      };
      const first = selectVisibleIds(s)[0] ?? null;
      s.selection = { activeId: first, ids: first ? [first] : [] };
      s.library.removedCount = trashed.length;
      s.library.status = unindexed.length
        ? { kind: "indexing", done: 0, total: unindexed.length }
        : records.length
          ? { kind: "ready" }
          : { kind: "error", message: `No supported photos found in “${folder.name}”.` };
    });

    if (unindexed.length) void indexPhotos(ctx, folder.id, unindexed);
    return { count: records.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.update((s) => {
      s.library.status = { kind: "error", message: `Couldn't read “${folder.name}”: ${message}` };
    });
    throw error;
  }
}
