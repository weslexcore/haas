import { imageMimeType, sidecarCandidates } from "../core/library/formats";
import type { PhotoSource, SourceFile } from "../core/services";
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
    return [...this.files]
      .filter(([path]) => imageMimeType(path))
      .map(([path, f]) => ({
        path,
        name: path.slice(path.lastIndexOf("/") + 1),
        size: f.data.size,
        lastModified: f.lastModified,
        mimeType: imageMimeType(path)!,
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
    if (!this.folder.canWriteSidecars) throw new Error("Read-only folder.");
    const path = this.sidecarPath(photoPath) ?? sidecarCandidates(photoPath)[0]!;
    this.files.set(path, { data: new Blob([text]), lastModified: Date.now() });
    this.writes++;
  }
}
