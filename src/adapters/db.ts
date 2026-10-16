import Dexie, { type Table } from "dexie";
import type { MetadataStore, StoredPhotoMeta } from "../core/services";

export interface FolderRow {
  id: string;
  name: string;
  kind: "fs-access" | "sample";
  /** Persisted directory handle (structured-cloneable), so the folder can be reopened next session. */
  handle?: FileSystemDirectoryHandle;
  addedAt: number;
  lastOpenedAt: number;
}

export interface MetadataRow extends Partial<StoredPhotoMeta> {
  folderId: string;
  path: string;
}

export interface ThumbRow {
  key: string;
  blob: Blob;
  width: number;
  height: number;
  at: number;
}

export class PhotoDB extends Dexie {
  folders!: Table<FolderRow, string>;
  metadata!: Table<MetadataRow, [string, string]>;
  thumbs!: Table<ThumbRow, string>;

  constructor(name = "photo") {
    super(name);
    this.version(1).stores({
      folders: "id, lastOpenedAt",
      metadata: "[folderId+path], folderId",
      thumbs: "key, at",
    });
  }
}

/** Culling metadata and cached index data in IndexedDB. */
export class DexieMetadataStore implements MetadataStore {
  constructor(private readonly db: PhotoDB) {}

  async load(folderId: string): Promise<Map<string, StoredPhotoMeta>> {
    const rows = await this.db.metadata.where("folderId").equals(folderId).toArray();
    return new Map(
      rows.map(({ folderId: _f, path, ...meta }) => [
        path,
        { rating: 0, flag: "none", colorLabel: "none", savedAt: 0, ...meta } as StoredPhotoMeta,
      ]),
    );
  }

  async save(folderId: string, entries: Array<{ path: string } & Partial<StoredPhotoMeta>>): Promise<void> {
    if (!entries.length) return;
    await this.db.transaction("rw", this.db.metadata, async () => {
      const keys = entries.map((e) => [folderId, e.path] as [string, string]);
      const existing = await this.db.metadata.bulkGet(keys);
      await this.db.metadata.bulkPut(entries.map((e, i) => ({ ...existing[i], ...e, folderId })));
    });
  }

  async remove(folderId: string, paths: string[]): Promise<void> {
    await this.db.metadata.bulkDelete(paths.map((p) => [folderId, p] as [string, string]));
  }
}

/** For tests and environments without IndexedDB. */
export class MemoryMetadataStore implements MetadataStore {
  private data = new Map<string, Map<string, StoredPhotoMeta>>();

  async load(folderId: string): Promise<Map<string, StoredPhotoMeta>> {
    return new Map(this.data.get(folderId) ?? []);
  }

  async save(folderId: string, entries: Array<{ path: string } & Partial<StoredPhotoMeta>>): Promise<void> {
    const folder = this.data.get(folderId) ?? new Map<string, StoredPhotoMeta>();
    for (const { path, ...meta } of entries) {
      folder.set(path, { rating: 0, flag: "none", colorLabel: "none", savedAt: 0, ...folder.get(path), ...meta });
    }
    this.data.set(folderId, folder);
  }

  async remove(folderId: string, paths: string[]): Promise<void> {
    for (const p of paths) this.data.get(folderId)?.delete(p);
  }
}
