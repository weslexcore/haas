/// <reference path="./fs-types.d.ts" />
import {
  EXPORTS_DIR,
  TRASH_DIR,
  uniqueNameAsync,
  imageMimeType,
  isIgnoredDir,
  isSidecarPath,
  pairRawWithJpeg,
  sidecarCandidates,
  splitPath,
  trashPath,
} from "../core/library/formats";
import type { FileOpResult, PhotoSource, SourceFile } from "../core/services";
import type { FolderInfo } from "../core/state/types";

const STAT_CONCURRENCY = 32;

type FileEntry = { path: string; handle: FileSystemFileHandle };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A folder opened with the File System Access API. Reads photos. With write
 * access it writes XMP sidecars and moves photos to and from the _Rejected
 * subfolder; it only deletes anything when that folder is emptied.
 */
export class FsAccessSource implements PhotoSource {
  private photos = new Map<string, FileSystemFileHandle>();
  /** Sidecars by lower-cased path (file systems may be case-insensitive). */
  private sidecars = new Map<string, FileEntry>();
  /** RAW+JPEG pairs: the JPEG by its RAW's path. */
  private companions = new Map<string, FileEntry>();

  constructor(
    readonly folder: FolderInfo,
    private readonly root: FileSystemDirectoryHandle,
  ) {}

  async listFiles(): Promise<SourceFile[]> {
    this.photos.clear();
    this.sidecars.clear();
    this.companions.clear();
    const images = new Map<string, FileEntry>();
    await this.walk(this.root, "", (entry) => {
      if (isSidecarPath(entry.path)) this.sidecars.set(entry.path.toLowerCase(), entry);
      else if (imageMimeType(entry.path)) images.set(entry.path, entry);
    });
    const { photos, companions } = pairRawWithJpeg([...images.keys()]);
    for (const [raw, jpeg] of companions) this.companions.set(raw, images.get(jpeg)!);
    const found = photos.map((path) => images.get(path)!);
    for (const entry of found) this.photos.set(entry.path, entry.handle);
    return stat(found, companions);
  }

  private async walk(
    dir: FileSystemDirectoryHandle,
    prefix: string,
    visit: (entry: FileEntry) => void,
    skipTrash = true,
  ): Promise<void> {
    const subdirs: Array<Promise<void>> = [];
    for await (const entry of dir.values()) {
      const path = prefix + entry.name;
      if (entry.kind === "directory") {
        if (!isIgnoredDir(entry.name, skipTrash && prefix === "")) {
          subdirs.push(this.walk(entry as FileSystemDirectoryHandle, `${path}/`, visit, skipTrash));
        }
      } else if (!entry.name.startsWith("._")) {
        visit({ path, handle: entry as FileSystemFileHandle });
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
    this.requireWritable();
    let found = this.findSidecar(photoPath);
    if (!found) {
      const path = sidecarCandidates(photoPath)[0]!;
      const { dir, name } = splitPath(path);
      const parent = await this.dirAt(dir, true);
      found = { path, handle: await parent.getFileHandle(name, { create: true }) };
      this.sidecars.set(path.toLowerCase(), found);
    }
    const writable = await found.handle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  // ── Trash ────────────────────────────────────────────────────────────

  async moveToTrash(photoPaths: string[]): Promise<FileOpResult<string>> {
    this.requireWritable();
    const result: FileOpResult<string> = { done: [], failed: [] };
    for (const path of photoPaths) {
      try {
        const handle = this.photos.get(path);
        if (!handle) throw new Error("Not in this folder");
        const sidecar = this.findSidecar(path);
        await this.move(path, handle, trashPath(path));
        this.photos.delete(path);
        if (sidecar) {
          await this.move(sidecar.path, sidecar.handle, trashPath(sidecar.path));
          this.sidecars.delete(sidecar.path.toLowerCase());
        }
        const companion = this.companions.get(path);
        if (companion) {
          await this.move(companion.path, companion.handle, trashPath(companion.path));
          this.companions.delete(path);
        }
        result.done.push(path);
      } catch (e) {
        result.failed.push({ path, error: message(e) });
      }
    }
    return result;
  }

  async restoreFromTrash(photoPaths?: string[]): Promise<FileOpResult<SourceFile>> {
    this.requireWritable();
    const trash = await this.trashEntries();
    const wanted = photoPaths ? new Set(photoPaths) : null;
    const result: FileOpResult<SourceFile> = { done: [], failed: [] };
    for (const [path, entry] of trash.photos) {
      if (wanted && !wanted.has(path)) continue;
      try {
        await this.move(entry.path, entry.handle, path);
        const handle = await this.fileAt(path);
        this.photos.set(path, handle);
        for (const candidate of sidecarCandidates(path)) {
          const sidecar = trash.sidecars.get(candidate.toLowerCase());
          if (!sidecar) continue;
          await this.move(sidecar.path, sidecar.handle, candidate);
          this.sidecars.set(candidate.toLowerCase(), { path: candidate, handle: await this.fileAt(candidate) });
        }
        const companion = trash.companions.get(path);
        if (companion) {
          const original = companion.path.slice(TRASH_DIR.length + 1);
          await this.move(companion.path, companion.handle, original);
          this.companions.set(path, { path: original, handle: await this.fileAt(original) });
        }
        result.done.push(...(await stat([{ path, handle }], new Map(companion ? [[path, companion.path.slice(TRASH_DIR.length + 1)]] : []))));
      } catch (e) {
        result.failed.push({ path, error: message(e) });
      }
    }
    for (const path of wanted ?? []) {
      if (!trash.photos.has(path)) result.failed.push({ path, error: `Not in the ${TRASH_DIR} folder` });
    }
    return result;
  }

  async listTrash(): Promise<SourceFile[]> {
    const { photos } = await this.trashEntries();
    return stat([...photos].map(([path, e]) => ({ path, handle: e.handle })));
  }

  async emptyTrash(): Promise<number> {
    this.requireWritable();
    const { photos } = await this.trashEntries();
    await this.root.removeEntry(TRASH_DIR, { recursive: true }).catch((e: unknown) => {
      if (!(e instanceof DOMException && e.name === "NotFoundError")) throw e;
    });
    return photos.size;
  }

  /** Files in the trash, keyed by their original path. */
  private async trashEntries() {
    const photos = new Map<string, FileEntry>();
    const sidecars = new Map<string, FileEntry>();
    const companions = new Map<string, FileEntry>();
    let trashDir: FileSystemDirectoryHandle;
    try {
      trashDir = await this.root.getDirectoryHandle(TRASH_DIR);
    } catch {
      return { photos, sidecars, companions };
    }
    const images = new Map<string, FileEntry>();
    await this.walk(
      trashDir,
      "",
      (entry) => {
        const full = { path: trashPath(entry.path), handle: entry.handle };
        if (isSidecarPath(entry.path)) sidecars.set(entry.path.toLowerCase(), full);
        else if (imageMimeType(entry.path)) images.set(entry.path, full);
      },
      false,
    );
    const paired = pairRawWithJpeg([...images.keys()]);
    for (const path of paired.photos) photos.set(path, images.get(path)!);
    for (const [raw, jpeg] of paired.companions) companions.set(raw, images.get(jpeg)!);
    return { photos, sidecars, companions };
  }

  async writeExport(fileName: string, data: Blob): Promise<string> {
    this.requireWritable();
    const dir = await this.root.getDirectoryHandle(EXPORTS_DIR, { create: true });
    const name = await uniqueNameAsync(fileName, (n) => dir.getFileHandle(n).then(() => true, () => false));
    const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await writable.write(data);
    await writable.close();
    return `${EXPORTS_DIR}/${name}`;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private requireWritable(): void {
    if (!this.folder.writable) throw new Error("This folder was opened without write access.");
  }

  private async dirAt(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let dir = this.root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  }

  private async fileAt(path: string): Promise<FileSystemFileHandle> {
    const { dir, name } = splitPath(path);
    return (await this.dirAt(dir, false)).getFileHandle(name);
  }

  /**
   * Move a file within the folder. Uses the native move() where available;
   * otherwise copies, checks the copy's size, and only then removes the original.
   */
  private async move(fromPath: string, handle: FileSystemFileHandle, toPath: string): Promise<void> {
    const from = splitPath(fromPath);
    const to = splitPath(toPath);
    const destDir = await this.dirAt(to.dir, true);
    const exists = await destDir.getFileHandle(to.name).then(
      () => true,
      () => false,
    );
    if (exists) throw new Error(`${toPath} already exists`);

    if (typeof handle.move === "function") {
      try {
        await handle.move(destDir, to.name);
        return;
      } catch (e) {
        // Some file systems/browsers can't move; fall back to copy + delete.
        const fallback = ["NotSupportedError", "InvalidModificationError", "NotAllowedError"];
        if (!(e instanceof DOMException) || !fallback.includes(e.name)) throw e;
      }
    }
    const file = await handle.getFile();
    const copy = await destDir.getFileHandle(to.name, { create: true });
    const writable = await copy.createWritable();
    await writable.write(file);
    await writable.close();
    if ((await copy.getFile()).size !== file.size) {
      await destDir.removeEntry(to.name).catch(() => undefined);
      throw new Error(`Copy of ${fromPath} was incomplete; original kept`);
    }
    await (await this.dirAt(from.dir, false)).removeEntry(from.name);
  }
}

async function stat(entries: FileEntry[], companions?: Map<string, string>): Promise<SourceFile[]> {
  const out: SourceFile[] = new Array(entries.length);
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const i = next++;
      const { path, handle } = entries[i]!;
      const file = await handle.getFile();
      out[i] = { path, name: file.name, size: file.size, lastModified: file.lastModified, mimeType: imageMimeType(path)! };
      const companion = companions?.get(path);
      if (companion) out[i]!.companion = companion;
    }
  };
  await Promise.all(Array.from({ length: Math.min(STAT_CONCURRENCY, entries.length) }, worker));
  return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}
