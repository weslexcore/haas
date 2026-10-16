import type { PhotoIndexData } from "../../core/services";

export type PreviewTask =
  | { type: "thumbnail"; file: Blob; maxSize: number }
  | { type: "index"; file: Blob; mimeType: string };

export interface ThumbnailResult {
  blob: Blob;
  width: number;
  height: number;
}

export type TaskResult<T extends PreviewTask> = T extends { type: "thumbnail" } ? ThumbnailResult | null : PhotoIndexData;

export type WorkerRequest = { id: number; task: PreviewTask };
export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
