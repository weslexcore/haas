import { TRASH_DIR, imageMimeType, sidecarCandidates, trashPath } from "../core/library/formats";
import type { FileOpResult, PhotoSource, SourceFile } from "../core/services";
import type { FolderInfo } from "../core/state/types";

export interface MemoryFile {
  data: Blob;
  lastModified: number;
}

/** An in-memory folder (tests, and a model for a future server-backed source). */
export class MemorySource implements PhotoSource {
  readonly files = new Map<string, MemoryFile>();
  writes = 0;

  constructor(
    readonly folder: FolderInfo,
    initial: Record<string, Blob | string> = {},
  ) {
    for (const [path, data] of Object.entries(initial)) {
      this.files.set(path, { data: typeof data === "string" ? new Blob([data]) : data, lastModified: 1_700_000_000_000 });
    }
  }

  async listFiles(): Promise<SourceFile[]> {
    return this.list((path) => !path.startsWith(`${TRASH_DIR}/`));
  }

  private list(include: (path: string) => boolean, rename: (path: string) => string = (p) => p): SourceFile[] {
    return [...this.files]
      .filter(([path]) => imageMimeType(path) && include(path))
      .map(([full, f]) => ({
        path: rename(full),
        name: full.slice(full.lastIndexOf("/") + 1),
        size: f.data.size,
        lastModified: f.lastModified,
        mimeType: imageMimeType(full)!,
      }))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  }

  async getFile(path: string): Promise<File> {
    const f = this.files.get(path);
    if (!f) throw new Error(`No file ${path}`);
    return new File([f.data], path.slice(path.lastIndexOf("/") + 1), { lastModified: f.lastModified });
  }

  private sidecarPath(photoPath: string): string | undefined {
    return sidecarCandidates(photoPath).find((p) => this.files.has(p));
  }

  async readSidecar(photoPath: string) {
    const path = this.sidecarPath(photoPath);
    if (!path) return null;
    const f = this.files.get(path)!;
    return { text: await f.data.text(), lastModified: f.lastModified };
  }

  async writeSidecar(photoPath: string, text: string): Promise<void> {
    if (!this.folder.writable) throw new Error("Read-only folder.");
    const path = this.sidecarPath(photoPath) ?? sidecarCandidates(photoPath)[0]!;
    this.files.set(path, { data: new Blob([text]), lastModified: Date.now() });
    this.writes++;
  }

  private move(from: string, to: string): void {
    if (this.files.has(to)) throw new Error(`${to} already exists`);
    this.files.set(to, this.files.get(from)!);
    this.files.delete(from);
  }

  async moveToTrash(photoPaths: string[]): Promise<FileOpResult<string>> {
    if (!this.folder.writable) throw new Error("Read-only folder.");
    const result: FileOpResult<string> = { done: [], failed: [] };
    for (const path of photoPaths) {
      try {
        if (!this.files.has(path)) throw new Error("Not in this folder");
        const sidecar = this.sidecarPath(path);
        this.move(path, trashPath(path));
        if (sidecar) this.move(sidecar, trashPath(sidecar));
        result.done.push(path);
      } catch (e) {
        result.failed.push({ path, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return result;
  }

  async restoreFromTrash(photoPaths?: string[]): Promise<FileOpResult<SourceFile>> {
    if (!this.folder.writable) throw new Error("Read-only folder.");
    const trashed = await this.listTrash();
    const result: FileOpResult<SourceFile> = { done: [], failed: [] };
    for (const file of trashed) {
      if (photoPaths && !photoPaths.includes(file.path)) continue;
      try {
        this.move(trashPath(file.path), file.path);
        for (const c of sidecarCandidates(file.path)) if (this.files.has(trashPath(c))) this.move(trashPath(c), c);
        result.done.push(file);
      } catch (e) {
        result.failed.push({ path: file.path, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return result;
  }

  async listTrash(): Promise<SourceFile[]> {
    const prefix = `${TRASH_DIR}/`;
    return this.list((p) => p.startsWith(prefix), (p) => p.slice(prefix.length));
  }

  async emptyTrash(): Promise<number> {
    if (!this.folder.writable) throw new Error("Read-only folder.");
    const count = (await this.listTrash()).length;
    for (const path of [...this.files.keys()]) if (path.startsWith(`${TRASH_DIR}/`)) this.files.delete(path);
    return count;
  }
}
