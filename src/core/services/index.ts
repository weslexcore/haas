import type { PixelData } from "../develop/auto";
import type { EditRecipe } from "../develop/recipe";
import type { ColorLabel, ExifSummary, Flag, FolderInfo, PhotoRecord } from "../state/types";

/**
 * Service interfaces. Core code depends only on these; browser (and later
 * server) implementations live in src/adapters.
 */

/** Small key/value store for preferences: keybinding overrides, theme, recents. */
export interface SettingsStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SourceFile {
  /** Path relative to the folder root, using "/" separators. */
  path: string;
  name: string;
  size: number;
  lastModified: number;
  mimeType: string;
  /** RAW+JPEG pair: the JPEG's path. It is not listed separately and moves with the RAW. */
  companion?: string;
  /** Sample library only: synthetic preview colour, capture time and size (there is no real file). */
  sample?: { hue: number; capturedAt: string; width: number; height: number };
}

/**
 * One opened folder of photos. Originals are only ever read; the only
 * writes are XMP sidecars, and only when `folder.writable`.
 */
export interface PhotoSource {
  readonly folder: FolderInfo;
  /** Image files, recursively. */
  listFiles(): Promise<SourceFile[]>;
  getFile(path: string): Promise<File>;
  /** The photo's XMP sidecar, if there is one. */
  readSidecar(photoPath: string): Promise<{ text: string; lastModified: number } | null>;
  writeSidecar(photoPath: string, text: string): Promise<void>;
  /**
   * Move photos (and their sidecars) into the TRASH_DIR subfolder, keeping
   * their relative paths. Needs write access. Partial success is reported.
   */
  moveToTrash(photoPaths: string[]): Promise<FileOpResult<string>>;
  /** Move trashed photos back to their original paths (all, if none given). */
  restoreFromTrash(photoPaths?: string[]): Promise<FileOpResult<SourceFile>>;
  /** Trashed photos, by original path. */
  listTrash(): Promise<SourceFile[]>;
  /** Permanently delete the trash folder. Returns how many photos were deleted. */
  emptyTrash(): Promise<number>;
  /** Write an exported file into EXPORTS_DIR without overwriting anything. Returns its path. */
  writeExport(fileName: string, data: Blob): Promise<string>;
}

export interface FileOpResult<T> {
  done: T[];
  failed: Array<{ path: string; error: string }>;
}

/** Opens folders and remembers them between sessions. */
export interface LibraryProvider {
  current(): PhotoSource | null;
  /** Ask the user for a folder (File System Access API, or a file input fallback). Null if cancelled. */
  pickFolder(): Promise<PhotoSource | null>;
  openSample(): Promise<PhotoSource>;
  /** Reopen the last folder if permission is still granted. */
  restoreLast(): Promise<{ source: PhotoSource } | { needsPermission: FolderInfo } | null>;
  /** Re-request permission for a remembered folder. Needs a user gesture. */
  reconnect(folderId: string): Promise<PhotoSource | null>;
  recentFolders(): Promise<FolderInfo[]>;
}

/** Culling metadata plus cached index data, persisted per folder. */
export interface StoredPhotoMeta {
  rating: number;
  flag: Flag;
  colorLabel: ColorLabel;
  /** When rating/flag/label were last saved (ms). Compared with sidecar mtime on load. */
  savedAt: number;
  /** size-lastModified of the file the index fields came from. */
  fileKey?: string;
  capturedAt?: string;
  width?: number;
  height?: number;
  exif?: ExifSummary;
  /** Develop settings; null once reset to unedited. */
  edit?: EditRecipe | null;
}

export interface MetadataStore {
  load(folderId: string): Promise<Map<string, StoredPhotoMeta>>;
  /** Merge fields into each photo's stored record. */
  save(folderId: string, entries: Array<{ path: string } & Partial<StoredPhotoMeta>>): Promise<void>;
  /** Forget photos (after they are permanently deleted). */
  remove(folderId: string, paths: string[]): Promise<void>;
}

/** Lets file operations wait until pending metadata/sidecar writes have finished. */
export interface PersistenceBarrier {
  flush(): Promise<void>;
}

/** Index data read from an image file (EXIF). */
export interface PhotoIndexData {
  capturedAt?: string;
  width?: number;
  height?: number;
  exif?: ExifSummary;
}

/** Decoding, thumbnails and EXIF, run off the main thread where possible. */
export interface PreviewService {
  /** Object URL for a cached-or-generated thumbnail, or null when it can't be decoded. */
  thumbnailUrl(photo: PhotoRecord, signal?: AbortSignal): Promise<string | null>;
  /** Object URL for the full-size image. */
  imageUrl(photo: PhotoRecord): Promise<string | null>;
  readIndexData(photo: PhotoRecord): Promise<PhotoIndexData | null>;
  /**
   * Decode the photo (oriented) for editing or export, optionally scaled so
   * its long edge is at most maxEdge. Sample photos get a synthetic image.
   */
  decode(photo: PhotoRecord, opts?: { maxEdge?: number }): Promise<ImageBitmap | null>;
  /**
   * Small unedited RGBA pixels of the photo (oriented, long edge at most
   * maxEdge), for analysis such as Auto. Null when it can't be decoded.
   */
  readPixels(photo: PhotoRecord, opts: { maxEdge: number }): Promise<PixelData | null>;
  /** Drop cached object URLs (e.g. when the folder changes). */
  reset(): void;
}

export interface PlanStep {
  actionId: string;
  params: unknown;
  reason: string;
}

export interface Plan {
  summary: string;
  steps: PlanStep[];
}

/** A read-only query the model may call while planning. */
export interface AITool {
  /** Action id, e.g. "library.photos.list". */
  actionId: string;
  description: string;
  /** JSON Schema of the params object. */
  inputSchema: Record<string, unknown>;
}

export interface AIRequest {
  /** The user's words for this turn. */
  prompt: string;
  /** The full message for this turn (context, suggestion status, request). */
  message: string;
  /** Earlier turns, replayed verbatim. */
  history: Array<{ role: "user" | "assistant"; text: string }>;
  /** The generated action manifest (actions.json contents). */
  manifest: unknown;
  /** Current app context, from query actions. */
  context: unknown;
  /** Read-only queries the model can use to inspect the library before planning. */
  tools: AITool[];
  callTool(actionId: string, input: unknown): Promise<unknown>;
  signal?: AbortSignal;
}

export type AIModel = "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-haiku-5-5";

export interface AIProvider {
  readonly name: string;
  readonly model: AIModel;
  isConfigured(): boolean;
  /** Set or clear the API key and model; persisted locally. */
  configure(settings: { apiKey?: string | null; model?: AIModel }): Promise<void>;
  propose(request: AIRequest): Promise<Plan>;
}

export interface CapturedImage {
  photoId: string;
  mediaType: "image/jpeg";
  /** Base64 JPEG data. */
  data: string;
  width: number;
  height: number;
  edited: boolean;
}

/** Renders photos as images an AI model can look at. */
export interface VisionService {
  capture(photo: PhotoRecord, opts: { maxEdge: number; edited: boolean }): Promise<CapturedImage>;
}

/** Query results carrying images (passed to the model as image content, not JSON). */
export interface VisionResult {
  kind: "images";
  images: CapturedImage[];
}

export function isVisionResult(value: unknown): value is VisionResult {
  return !!value && typeof value === "object" && (value as { kind?: unknown }).kind === "images" && Array.isArray((value as { images?: unknown }).images);
}

/** Hands a generated file to the user (browser download, or a server upload later). */
export interface DownloadService {
  save(fileName: string, content: string, mimeType: string): void;
  saveBlob(fileName: string, blob: Blob): void;
}

/** Full-resolution rendering of edits to a JPEG (in a worker where possible). */
export interface ExportService {
  renderJpeg(
    image: ImageBitmap,
    recipe: EditRecipe,
    opts: { quality: number; maxEdge?: number },
  ): Promise<{ blob: Blob; width: number; height: number }>;
}

export interface Services {
  settings: SettingsStore;
  library: LibraryProvider;
  metadata: MetadataStore;
  previews: PreviewService;
  persistence: PersistenceBarrier;
  exporter: ExportService;
  vision: VisionService;
  ai: AIProvider;
  downloads: DownloadService;
}
