import type { Profile } from "../develop/profiles";
import type { EditRecipe, SettingsGroup } from "../develop/recipe";
import type { AiTurn } from "../ai/thread";
import { initialLayout, type LayoutState } from "./layout";

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
  /** Develop settings; absent means unedited. */
  edit?: EditRecipe;
}

export interface FolderInfo {
  id: string;
  name: string;
  kind: "fs-access" | "file-list" | "sample" | "memory";
  /** Opened with write access: XMP sidecars can be written and photos moved to the _Rejected folder. */
  writable: boolean;
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

export interface DevelopState {
  /** Settings copied with develop.settings.copy, and which groups to paste. */
  clipboard: { recipe: EditRecipe; groups: SettingsGroup[] } | null;
  /** Crop & straighten overlay is active. */
  cropTool: boolean;
  /** In the crop overlay, the next drag draws a line to straighten along. */
  levelTool: boolean;
  /** The user's own profiles (built-ins are in core/develop/profiles.ts). Persisted in local settings. */
  profiles: Profile[];
}

export interface AppState {
  view: ViewMode;
  theme: ThemePreference;
  beforeAfter: boolean;
  /** Loupe: fit to window, or 100% (one image pixel per device pixel). */
  zoom: "fit" | "actual";
  infoOverlay: boolean;
  filmstrip: boolean;
  /** Panel and filmstrip placement and sizes. */
  layout: LayoutState;
  autoAdvance: AutoAdvanceMode;
  palette: PaletteState;
  contextMenu: ContextMenuState | null;
  shortcutsOpen: boolean;
  develop: DevelopState;
  ai: {
    /** An AI plan is being previewed: state shows its effects but nothing is persisted or recorded. */
    previewing: boolean;
    settingsOpen: boolean;
    panelOpen: boolean;
    /** The conversation with the AI for the open folder. */
    thread: AiTurn[];
  };
  library: {
    folder: FolderInfo | null;
    status: LibraryStatus;
    filter: LibraryFilter;
    sort: LibrarySort;
    /** Photos moved to the folder's _Rejected subfolder (restorable until it is emptied). */
    removedCount: number;
    /**
     * A RAW and a JPEG with the same name are one photo (the RAW; the JPEG is hidden and
     * moves with it), as in Lightroom. Off: they are two photos. Persisted.
     */
    groupRawJpeg: boolean;
  };
  photos: {
    /**
     * Every image file, in load order (by path). Grouped RAW+JPEG pairs keep their JPEG here
     * too: selectLibraryIds() leaves it out, and selectVisibleIds() also filters and sorts.
     */
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
  layout: initialLayout,
  autoAdvance: "capsLock",
  palette: { open: false, actionId: null },
  contextMenu: null,
  shortcutsOpen: false,
  develop: { clipboard: null, cropTool: false, levelTool: false, profiles: [] },
  ai: { previewing: false, settingsOpen: false, panelOpen: false, thread: [] },
  library: { folder: null, status: { kind: "empty" }, filter: defaultFilter, sort: defaultSort, removedCount: 0, groupRawJpeg: true },
  photos: { order: [], byId: {} },
  selection: { activeId: null, ids: [] },
};
