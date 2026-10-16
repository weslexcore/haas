/// <reference path="./fs-types.d.ts" />
import { imageMimeType, isIgnoredDir, isSidecarPath, sidecarCandidates, splitPath } from "../core/library/formats";
import type { PhotoSource, SourceFile } from "../core/services";
import type { FolderInfo } from "../core/state/types";

const STAT_CONCURRENCY = 32;

/**
 * A folder opened with the File System Access API. Reads photos; writes only
 * XMP sidecars, and only with readwrite permission.
 */
export class FsAccessSource implements PhotoSource {
  private photos = new Map<string, FileSystemFileHandle>();
  /** Sidecars by lower-cased path (file systems may be case-insensitive). */
  private sidecars = new Map<string, { path: string; handle: FileSystemFileHandle }>();

  constructor(
    readonly folder: FolderInfo,
    private readonly root: FileSystemDirectoryHandle,
  ) {}

  async listFiles(): Promise<SourceFile[]> {
    this.photos.clear();
    this.sidecars.clear();
    await this.walk(this.root, "");
    const entries = [...this.photos];
    const out: SourceFile[] = new Array(entries.length);
    let next = 0;
    const stat = async () => {
      while (next < entries.length) {
        const i = next++;
        const [path, handle] = entries[i]!;
        const file = await handle.getFile();
        out[i] = { path, name: file.name, size: file.size, lastModified: file.lastModified, mimeType: imageMimeType(path)! };
      }
    };
    await Promise.all(Array.from({ length: Math.min(STAT_CONCURRENCY, entries.length) }, stat));
    return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  }

  private async walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    const subdirs: Array<Promise<void>> = [];
    for await (const entry of dir.values()) {
      const path = prefix + entry.name;
      if (entry.kind === "directory") {
        if (!isIgnoredDir(entry.name)) subdirs.push(this.walk(entry as FileSystemDirectoryHandle, `${path}/`));
      } else if (isSidecarPath(path)) {
        this.sidecars.set(path.toLowerCase(), { path, handle: entry as FileSystemFileHandle });
      } else if (imageMimeType(path) && !entry.name.startsWith("._")) {
        this.photos.set(path, entry as FileSystemFileHandle);
      }
    }
    await Promise.all(subdirs);
  }

  async getFile(path: string): Promise<File> {
    const handle = this.photos.get(path);
    if (!handle) throw new Error(`Not in this folder: ${path}`);
    return handle.getFile();
  }

  private findSidecar(photoPath: string) {
    for (const c of sidecarCandidates(photoPath)) {
      const found = this.sidecars.get(c.toLowerCase());
      if (found) return found;
    }
    return undefined;
  }

  async readSidecar(photoPath: string) {
    const found = this.findSidecar(photoPath);
    if (!found) return null;
    const file = await found.handle.getFile();
    return { text: await file.text(), lastModified: file.lastModified };
  }

  async writeSidecar(photoPath: string, text: string): Promise<void> {
    if (!this.folder.canWriteSidecars) throw new Error("No write permission for this folder.");
    let found = this.findSidecar(photoPath);
    if (!found) {
      const path = sidecarCandidates(photoPath)[0]!;
      const { dir, name } = splitPath(path);
      let parent = this.root;
      for (const d of dir) parent = await parent.getDirectoryHandle(d);
      found = { path, handle: await parent.getFileHandle(name, { create: true }) };
      this.sidecars.set(path.toLowerCase(), found);
    }
    const writable = await found.handle.createWritable();
    await writable.write(text);
    await writable.close();
  }
}
