/// <reference path="./fs-types.d.ts" />
import type { LibraryProvider, PhotoSource } from "../core/services";
import type { FolderInfo } from "../core/state/types";
import type { FolderRow, PhotoDB } from "./db";
import { FileListSource, pickFilesFallback } from "./file-list-source";
import { FsAccessSource } from "./fs-access-source";
import { SAMPLE_FOLDER, SampleSource } from "./sample-source";

const toInfo = (row: FolderRow, writable = false): FolderInfo => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  writable: row.kind === "fs-access" && writable,
});

async function permission(handle: FileSystemDirectoryHandle, mode: "read" | "readwrite"): Promise<PermissionState> {
  return handle.queryPermission ? handle.queryPermission({ mode }) : "granted";
}

/**
 * Opens folders in the browser. Uses the File System Access API (with the
 * directory handle remembered in IndexedDB) where available, else a file
 * input fallback.
 */
export class BrowserLibraryProvider implements LibraryProvider {
  private active: PhotoSource | null = null;

  constructor(private readonly db: PhotoDB) {}

  current(): PhotoSource | null {
    return this.active;
  }

  async pickFolder(): Promise<PhotoSource | null> {
    if (typeof window.showDirectoryPicker === "function") {
      let handle: FileSystemDirectoryHandle;
      try {
        handle = await window.showDirectoryPicker({ id: "photo-library", mode: "readwrite" });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return null;
        throw error;
      }
      return this.openHandle(handle);
    }
    const files = await pickFilesFallback();
    return files ? (this.active = new FileListSource(files)) : null;
  }

  async openSample(): Promise<PhotoSource> {
    await this.remember({ id: SAMPLE_FOLDER.id, name: SAMPLE_FOLDER.name, kind: "sample" });
    return (this.active = new SampleSource());
  }

  async restoreLast() {
    const last = await this.db.folders.orderBy("lastOpenedAt").last();
    if (!last) return null;
    if (last.kind === "sample") return { source: await this.openSample() };
    if (!last.handle) return null;
    if ((await permission(last.handle, "read")) !== "granted") return { needsPermission: toInfo(last) };
    return { source: await this.openHandle(last.handle) };
  }

  async reconnect(folderId: string): Promise<PhotoSource | null> {
    const row = await this.db.folders.get(folderId);
    if (!row) return null;
    if (row.kind === "sample") return this.openSample();
    if (!row.handle) return null;
    if (row.handle.requestPermission) {
      let state = await row.handle.requestPermission({ mode: "readwrite" });
      if (state !== "granted") state = await row.handle.requestPermission({ mode: "read" });
      if (state !== "granted") return null;
    }
    return this.openHandle(row.handle);
  }

  async recentFolders(): Promise<FolderInfo[]> {
    const rows = await this.db.folders.orderBy("lastOpenedAt").reverse().toArray();
    return rows.map((r) => toInfo(r));
  }

  private async openHandle(handle: FileSystemDirectoryHandle): Promise<PhotoSource> {
    // Reuse the id of a folder we've seen, so stored ratings and thumbnails carry over.
    let id: string | undefined;
    for (const row of await this.db.folders.toArray()) {
      if (row.handle && (await row.handle.isSameEntry(handle))) {
        id = row.id;
        break;
      }
    }
    const row = await this.remember({ id: id ?? crypto.randomUUID().slice(0, 8), name: handle.name, kind: "fs-access", handle });
    const canWrite = (await permission(handle, "readwrite")) === "granted";
    return (this.active = new FsAccessSource(toInfo(row, canWrite), handle));
  }

  private async remember(row: Omit<FolderRow, "addedAt" | "lastOpenedAt">): Promise<FolderRow> {
    const existing = await this.db.folders.get(row.id);
    const full: FolderRow = { ...row, addedAt: existing?.addedAt ?? Date.now(), lastOpenedAt: Date.now() };
    await this.db.folders.put(full);
    return full;
  }
}
