import type { FileOpResult, PhotoSource, SourceFile } from "../core/services";
import type { FolderInfo } from "../core/state/types";

const READ_ONLY = "The sample library is read-only.";

export const SAMPLE_FOLDER: FolderInfo = { id: "sample", name: "Sample library", kind: "sample", writable: false };

/** Deterministic placeholder photos for trying the app (and for tests). There are no real files. */
export class SampleSource implements PhotoSource {
  readonly folder = SAMPLE_FOLDER;

  constructor(private readonly count = 48) {}

  async listFiles(): Promise<SourceFile[]> {
    const start = Date.UTC(2026, 8, 12, 6, 30);
    return Array.from({ length: this.count }, (_, i) => {
      const n = String(i + 1).padStart(4, "0");
      const t = new Date(start + i * 97_000).toISOString().slice(0, 19);
      return {
        path: `DSC_${n}.jpg`,
        name: `DSC_${n}.jpg`,
        size: 4_000_000 + i * 1000,
        lastModified: start + i * 97_000,
        mimeType: "image/jpeg",
        sample: { hue: (i * 47) % 360, capturedAt: t, width: 1500, height: 1000 },
      };
    });
  }

  async getFile(): Promise<File> {
    throw new Error("Sample photos have no file.");
  }

  async readSidecar() {
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
