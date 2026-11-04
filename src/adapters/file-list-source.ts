/// <reference path="./fs-types.d.ts" />
import { imageMimeType, isSidecarPath, pairRawWithJpeg, sidecarCandidates } from "../core/library/formats";
import type { FileOpResult, PhotoSource, SourceFile } from "../core/services";
import type { FolderInfo } from "../core/state/types";

const READ_ONLY = "This browser opened the folder read-only; ratings are kept in app storage and files can't be moved.";

/**
 * Fallback for browsers without the File System Access API (Safari, iPad,
 * Firefox): files from <input webkitdirectory> or a multi-file picker.
 * Read-only, so ratings live in app storage only. Not restorable after reload.
 */
export class FileListSource implements PhotoSource {
  readonly folder: FolderInfo;
  private photos = new Map<string, File>();
  private sidecars = new Map<string, File>();

  constructor(files: File[]) {
    const root = files[0]?.webkitRelativePath.split("/")[0] || "Selected photos";
    for (const file of files) {
      // webkitRelativePath is "Root/sub/a.jpg"; plain multi-select has none.
      const rel = file.webkitRelativePath ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name;
      if (isSidecarPath(rel)) this.sidecars.set(rel.toLowerCase(), file);
      else if (imageMimeType(rel)) this.photos.set(rel, file);
    }
    this.folder = { id: `files:${root}`, name: root, kind: "file-list", writable: false };
  }

  async listFiles(): Promise<SourceFile[]> {
    const { photos, companions } = pairRawWithJpeg([...this.photos.keys()]);
    return photos
      .map((path): SourceFile => {
        const f = this.photos.get(path)!;
        const companion = companions.get(path);
        return { path, name: f.name, size: f.size, lastModified: f.lastModified, mimeType: imageMimeType(path)!, ...(companion ? { companion } : {}) };
      })
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  }

  async getFile(path: string): Promise<File> {
    const f = this.photos.get(path);
    if (!f) throw new Error(`Not in this folder: ${path}`);
    return f;
  }

  async readSidecar(photoPath: string) {
    for (const c of sidecarCandidates(photoPath)) {
      const f = this.sidecars.get(c.toLowerCase());
      if (f) return { text: await f.text(), lastModified: f.lastModified };
    }
    return null;
  }

  async writeSidecar(): Promise<void> {
    throw new Error(READ_ONLY);
  }

  async moveToTrash(): Promise<FileOpResult<string>> {
    throw new Error(READ_ONLY);
  }

  async restoreFromTrash(): Promise<FileOpResult<SourceFile>> {
    throw new Error(READ_ONLY);
  }

  async listTrash(): Promise<SourceFile[]> {
    return [];
  }

  async emptyTrash(): Promise<number> {
    throw new Error(READ_ONLY);
  }

  async writeExport(): Promise<string> {
    throw new Error(READ_ONLY);
  }
}

/** Show a file picker for a folder (or files, where folders aren't supported). Null if cancelled. */
export function pickFilesFallback(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    const supportsFolders = "webkitdirectory" in HTMLInputElement.prototype;
    if (supportsFolders) input.webkitdirectory = true;
    else input.accept = "image/*";
    input.style.display = "none";
    input.addEventListener("change", () => {
      resolve(input.files?.length ? [...input.files] : null);
      input.remove();
    });
    input.addEventListener("cancel", () => {
      resolve(null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}
