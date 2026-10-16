import type { Services } from "../services";
import type { AppStore } from "../state/store";
import type { PhotoRecord } from "../state/types";
import { writeXmp } from "../xmp/xmp";

/** Fields persisted per photo; `edit` changes by reference whenever a develop setting changes. */
const CULLING_FIELDS = ["rating", "flag", "colorLabel", "edit"] as const;

const changedCulling = (a: PhotoRecord, b: PhotoRecord) => CULLING_FIELDS.some((k) => a[k] !== b[k]);

/**
 * Persists rating/flag/label/edit changes, whatever caused them (a command, undo,
 * an AI plan): to the metadata store always, and to XMP sidecars when the
 * folder allows writes. Diffing the store keeps actions free of I/O.
 */
export class MetadataSync {
  private pending = new Map<string, PhotoRecord>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly store: AppStore,
    private readonly services: Pick<Services, "metadata" | "library">,
    private readonly opts: { debounceMs?: number; onError?: (message: string) => void } = {},
  ) {}

  start(): void {
    this.unsubscribe = this.store.subscribe((state, prev) => {
      // Same folder only: loading a folder replaces photos wholesale and must not write anything.
      if (state.library.folder?.id !== prev.library.folder?.id) {
        this.pending.clear();
        return;
      }
      if (state.photos.byId === prev.photos.byId) return;
      // An AI plan preview (and leaving it) is never persisted; applying the plan is a normal change.
      if (state.ai.previewing || prev.ai.previewing) return;
      for (const id of state.photos.order) {
        const now = state.photos.byId[id];
        const before = prev.photos.byId[id];
        if (now && before && now !== before && changedCulling(now, before)) this.pending.set(id, now);
      }
      if (this.pending.size) this.schedule();
    });
  }

  stop(): void {
    this.unsubscribe?.();
    if (this.timer) clearTimeout(this.timer);
  }

  /** Write everything pending now. Resolves when writes finish. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = [...this.pending.values()];
    this.pending.clear();
    const folder = this.store.getState().library.folder;
    if (!batch.length || !folder) return this.flushing;
    this.flushing = this.flushing.then(() => this.write(folder.id, batch));
    return this.flushing;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.opts.debounceMs ?? 400);
  }

  private async write(folderId: string, photos: PhotoRecord[]): Promise<void> {
    const savedAt = Date.now();
    try {
      await this.services.metadata.save(
        folderId,
        photos.map((p) => ({
          path: p.id,
          rating: p.rating,
          flag: p.flag,
          colorLabel: p.colorLabel,
          edit: p.edit ?? null,
          savedAt,
        })),
      );
    } catch (error) {
      this.opts.onError?.(`Couldn't save ratings: ${String(error)}`);
    }

    const source = this.services.library.current();
    if (!source?.folder.writable || source.folder.id !== folderId) return;
    const failures: string[] = [];
    for (const p of photos) {
      // Moved to the trash (or otherwise gone) since it was queued: its sidecar moved with it.
      if (!this.store.getState().photos.byId[p.id]) continue;
      try {
        const existing = await source.readSidecar(p.id);
        await source.writeSidecar(p.id, writeXmp(existing?.text ?? null, p));
      } catch (error) {
        failures.push(`${p.fileName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length) {
      this.opts.onError?.(`Couldn't update ${failures.length} XMP sidecar(s). ${failures.slice(0, 3).join("; ")}`);
    }
  }
}
