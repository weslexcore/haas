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
  /** Sample library only: synthetic preview colour and capture time (there is no real file). */
  sample?: { hue: number; capturedAt: string };
}

/**
 * One opened folder of photos. Originals are only ever read; the only
 * writes are XMP sidecars, and only when `folder.canWriteSidecars`.
 */
export interface PhotoSource {
  readonly folder: FolderInfo;
  /** Image files, recursively. */
  listFiles(): Promise<SourceFile[]>;
  getFile(path: string): Promise<File>;
  /** The photo's XMP sidecar, if there is one. */
  readSidecar(photoPath: string): Promise<{ text: string; lastModified: number } | null>;
  writeSidecar(photoPath: string, text: string): Promise<void>;
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
}

export interface MetadataStore {
  load(folderId: string): Promise<Map<string, StoredPhotoMeta>>;
  /** Merge fields into each photo's stored record. */
  save(folderId: string, entries: Array<{ path: string } & Partial<StoredPhotoMeta>>): Promise<void>;
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

export interface AIRequest {
  prompt: string;
  /** The generated action manifest (actions.json contents). */
  manifest: unknown;
  /** Current app context, from query actions. */
  context: unknown;
}

export interface AIProvider {
  readonly name: string;
  isConfigured(): boolean;
  propose(request: AIRequest): Promise<Plan>;
}

/** Hands a generated file to the user (browser download, or a server upload later). */
export interface DownloadService {
  save(fileName: string, content: string, mimeType: string): void;
}

export interface Services {
  settings: SettingsStore;
  library: LibraryProvider;
  metadata: MetadataStore;
  previews: PreviewService;
  ai: AIProvider;
  downloads: DownloadService;
}
