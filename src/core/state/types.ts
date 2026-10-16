export type ViewMode = "grid" | "loupe" | "develop";
export type ThemePreference = "light" | "dark" | "system";
export type Flag = "pick" | "reject" | "none";
export type ColorLabel = "none" | "red" | "yellow" | "green" | "blue" | "purple";
export type AutoAdvanceMode = "capsLock" | "always" | "never";

export const FLAGS: readonly Flag[] = ["pick", "reject", "none"];
export const COLOR_LABELS: readonly ColorLabel[] = ["none", "red", "yellow", "green", "blue", "purple"];

export interface ExifSummary {
  make?: string;
  model?: string;
  lens?: string;
  focalLength?: number; // mm
  aperture?: number; // f-number
  exposureTime?: number; // seconds
  iso?: number;
}

export interface PhotoRecord {
  /** Path relative to the folder root, e.g. "2026-09/DSC_0001.jpg". Unique within the open folder. */
  id: string;
  fileName: string;
  /** Capture time in camera-local time, "YYYY-MM-DDTHH:mm:ss" (no zone). File modified time until EXIF is read. */
  capturedAt: string;
  rating: number; // 0–5
  flag: Flag;
  colorLabel: ColorLabel;
  size?: number;
  /** File modified time, ms since epoch. */
  lastModified?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  exif?: ExifSummary;
  /** True once EXIF has been read (or found not to exist). */
  indexed?: boolean;
  /** Placeholder preview colour for the sample library (no real file). */
  placeholderHue?: number;
}

export interface FolderInfo {
  id: string;
  name: string;
  kind: "fs-access" | "file-list" | "sample" | "memory";
  /** Whether XMP sidecars can be written next to the photos. */
  canWriteSidecars: boolean;
}

export type LibraryStatus =
  | { kind: "empty" }
  | { kind: "loading"; message: string }
  | { kind: "indexing"; done: number; total: number }
  | { kind: "ready" }
  | { kind: "needsPermission"; folder: FolderInfo }
  | { kind: "error"; message: string };

export interface LibraryFilter {
  /** Minimum star rating; 0 means any. */
  minRating: number;
  /** Only these flags; empty means any. */
  flags: Flag[];
  /** Only these colour labels; empty means any. */
  colorLabels: ColorLabel[];
  /** Case-insensitive substring of the file path. */
  text: string;
}

export type SortKey = "capturedAt" | "fileName" | "rating" | "size";

export interface LibrarySort {
  key: SortKey;
  direction: "asc" | "desc";
}

export interface PaletteState {
  open: boolean;
  /** When set, the palette opens directly on this action's parameter step. */
  actionId: string | null;
}

export interface ContextMenuState {
  menuId: string;
  /** Viewport position; null when opened from the keyboard (placed next to the active photo). */
  x: number | null;
  y: number | null;
}

export interface AppState {
  view: ViewMode;
  theme: ThemePreference;
  beforeAfter: boolean;
  /** Loupe: fit to window, or 100% (one image pixel per device pixel). */
  zoom: "fit" | "actual";
  infoOverlay: boolean;
  filmstrip: boolean;
  autoAdvance: AutoAdvanceMode;
  palette: PaletteState;
  contextMenu: ContextMenuState | null;
  shortcutsOpen: boolean;
  library: {
    folder: FolderInfo | null;
    status: LibraryStatus;
    filter: LibraryFilter;
    sort: LibrarySort;
  };
  photos: {
    /** Load order (by path). Display order comes from selectVisibleIds(). */
    order: string[];
    byId: Record<string, PhotoRecord>;
  };
  selection: {
    activeId: string | null;
    ids: string[];
  };
}

export const defaultFilter: LibraryFilter = { minRating: 0, flags: [], colorLabels: [], text: "" };
export const defaultSort: LibrarySort = { key: "capturedAt", direction: "asc" };

export const initialState: AppState = {
  view: "grid",
  theme: "system",
  beforeAfter: false,
  zoom: "fit",
  infoOverlay: false,
  filmstrip: true,
  autoAdvance: "capsLock",
  palette: { open: false, actionId: null },
  contextMenu: null,
  shortcutsOpen: false,
  library: { folder: null, status: { kind: "empty" }, filter: defaultFilter, sort: defaultSort },
  photos: { order: [], byId: {} },
  selection: { activeId: null, ids: [] },
};
