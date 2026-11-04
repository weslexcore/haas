import type { PhotoIndexData } from "../../core/services";

export type PreviewTask =
  | {
      type: "thumbnail";
      /** An image file, or already-decoded pixels (e.g. a RAW decode). */
      file: Blob | ImageBitmap;
      maxSize: number;
      /** EXIF orientation to apply, for images that don't carry their own (RAW embedded previews). */
      orientation?: number;
      /** JPEG quality of the result (default 0.82). */
      quality?: number;
    }
  | { type: "index"; file: Blob; mimeType: string };

export interface ThumbnailResult {
  blob: Blob;
  width: number;
  height: number;
}

export type TaskResult<T extends PreviewTask> = T extends { type: "thumbnail" } ? ThumbnailResult | null : PhotoIndexData;

export type WorkerRequest = { id: number; task: PreviewTask };
export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
