import type { DownloadService } from "../core/services";

export class BrowserDownloads implements DownloadService {
  save(fileName: string, content: string, mimeType: string): void {
    this.saveBlob(fileName, new Blob([content], { type: mimeType }));
  }

  saveBlob(fileName: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
