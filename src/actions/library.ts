import { z } from "zod";
import { defineAction } from "../core/actions/types";
import { hasPhotos, hasSelection, needsPermission } from "../core/actions/when";
import { INDEX_APPLY_ACTION } from "../core/library/indexer";
import { loadSource } from "../core/library/load";
import { matchesFilter, selectVisibleIds } from "../core/state/selectors";
import { defaultFilter } from "../core/state/types";
import { maybeAdvance, publicPhoto, targetIds } from "./context";

const photoIds = z
  .array(z.string())
  .min(1)
  .optional()
  .describe("Photos to change (their ids are relative paths). Omit to use the current selection.");

const advance = z
  .boolean()
  .optional()
  .describe(
    "Move to the next photo afterwards. When omitted, follows the auto-advance setting for interactive use; " +
      "AI and scripts never advance unless this is true.",
  );

const flagSchema = z.enum(["pick", "reject", "none"]);
const labelSchema = z.enum(["none", "red", "yellow", "green", "blue", "purple"]);
const localTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, "Use YYYY-MM-DD or YYYY-MM-DDTHH:mm[:ss]");

// ── Folders ──────────────────────────────────────────────────────────────

export const openFolder = defineAction({
  id: "library.folder.open",
  sideEffects: true,
  title: "Open Folder…",
  description:
    "Ask the user to choose a folder of photos and load it, replacing the current library. Subfolders are " +
    "included. Ratings, flags and labels are restored from app storage and XMP sidecars.",
  category: "Library",
  kind: "command",
  defaultShortcuts: [{ keys: "mod+o" }],
  async run(_, ctx) {
    const source = await ctx.services.library.pickFolder();
    if (!source) return { cancelled: true };
    return loadSource(ctx, source);
  },
});

export const reconnectFolder = defineAction({
  id: "library.folder.reconnect",
  sideEffects: true,
  title: "Reconnect Folder",
  description:
    "Grant the browser permission to read the last-used folder again and reload it. Needed after a restart " +
    "when the browser asks for permission again.",
  category: "Library",
  kind: "command",
  when: needsPermission,
  async run(_, ctx) {
    const status = ctx.state.library.status;
    if (status.kind !== "needsPermission") return { cancelled: true };
    const source = await ctx.services.library.reconnect(status.folder.id);
    if (!source) return { cancelled: true };
    return loadSource(ctx, source);
  },
});

export const openRecentFolder = defineAction({
  id: "library.folder.openRecent",
  sideEffects: true,
  title: "Open Recent Folder",
  description: "Reopen a previously used folder by id (see library.folders.recent). May ask the user for permission.",
  category: "Library",
  kind: "command",
  params: z.object({ folderId: z.string().describe("Folder id from library.folders.recent.") }),
  examples: [{ params: { folderId: "3f2a9c1e" }, description: "Reopen a remembered folder." }],
  async run({ folderId }, ctx) {
    const source = await ctx.services.library.reconnect(folderId);
    if (!source) return { cancelled: true };
    return loadSource(ctx, source);
  },
});

export const recentFolders = defineAction({
  id: "library.folders.recent",
  title: "List Recent Folders",
  description: "Return remembered folders (id, name, kind, whether sidecars can be written), most recent first.",
  category: "Library",
  kind: "query",
  run: (_, ctx) => ctx.services.library.recentFolders(),
});

export const openSample = defineAction({
  id: "library.sample.load",
  sideEffects: true,
  title: "Open Sample Library",
  description: "Load the built-in sample library of placeholder photos, for trying the app without real files.",
  category: "Library",
  kind: "command",
  async run(_, ctx) {
    return loadSource(ctx, await ctx.services.library.openSample());
  },
});

export const restoreFolder = defineAction({
  id: "library.folder.restore",
  sideEffects: true,
  title: "Restore Last Folder",
  description: "At startup, reopen the last folder if the browser still allows it; otherwise ask to reconnect.",
  category: "Library",
  kind: "command",
  internal: true,
  async run(_, ctx) {
    const result = await ctx.services.library.restoreLast();
    if (!result) return { restored: false };
    if ("needsPermission" in result) {
      ctx.update((s) => {
        s.library.folder = result.needsPermission;
        s.library.status = { kind: "needsPermission", folder: result.needsPermission };
      });
      return { restored: false, needsPermission: true };
    }
    await loadSource(ctx, result.source);
    return { restored: true };
  },
});

export const applyIndex = defineAction({
  id: INDEX_APPLY_ACTION,
  title: "Apply Index Results",
  description: "Store EXIF data read in the background (capture time, dimensions, camera settings) and report progress.",
  category: "Library",
  kind: "command",
  internal: true,
  params: z.object({
    updates: z
      .array(
        z.object({
          id: z.string(),
          capturedAt: z.string().optional(),
          width: z.number().optional(),
          height: z.number().optional(),
          exif: z
            .object({
              make: z.string().optional(),
              model: z.string().optional(),
              lens: z.string().optional(),
              focalLength: z.number().optional(),
              aperture: z.number().optional(),
              exposureTime: z.number().optional(),
              iso: z.number().optional(),
            })
            .optional(),
        }),
      )
      .describe("Index data per photo id."),
    done: z.number().int().min(0).describe("Photos indexed so far."),
    total: z.number().int().min(0).describe("Photos to index in this run."),
  }),
  examples: [
    {
      params: { updates: [{ id: "DSC_0001.jpg", capturedAt: "2026-09-12T06:30:00" }], done: 1, total: 10 },
      description: "Apply one result.",
    },
  ],
  run({ updates, done, total }, ctx) {
    ctx.update((s) => {
      for (const u of updates) {
        const p = s.photos.byId[u.id];
        if (!p) continue;
        if (u.capturedAt) p.capturedAt = u.capturedAt;
        if (u.width) p.width = u.width;
        if (u.height) p.height = u.height;
        if (u.exif) p.exif = u.exif;
        p.indexed = true;
      }
      s.library.status = done >= total ? { kind: "ready" } : { kind: "indexing", done, total };
    });
  },
});

// ── Selection & queries ──────────────────────────────────────────────────

export const setSelection = defineAction({
  id: "library.selection.set",
  title: "Select Photos",
  description:
    "Replace the selection with the given photos. activeId (default: the first id) becomes the active photo " +
    "shown in Loupe and Develop.",
  category: "Library",
  kind: "command",
  when: hasPhotos,
  params: z.object({
    ids: z.array(z.string()).min(1).describe("Photo ids to select, in order."),
    activeId: z.string().optional().describe("Which selected photo becomes active. Must be in ids."),
  }),
  examples: [
    { params: { ids: ["DSC_0003.jpg"] }, description: "Select a single photo." },
    {
      params: { ids: ["DSC_0001.jpg", "DSC_0002.jpg", "DSC_0003.jpg"], activeId: "DSC_0002.jpg" },
      description: "Select three, with the middle one active.",
    },
  ],
  run({ ids, activeId }, ctx) {
    targetIds(ctx.state, ids);
    if (activeId && !ids.includes(activeId)) throw new Error("activeId must be one of ids.");
    ctx.update((s) => {
      s.selection = { activeId: activeId ?? ids[0]!, ids };
    });
  },
});

export const selectAll = defineAction({
  id: "library.selection.all",
  title: "Select All",
  description: "Select every photo that passes the current filter, keeping the active photo if it is visible.",
  category: "Library",
  kind: "command",
  when: hasPhotos,
  defaultShortcuts: [{ keys: "mod+a" }],
  run(_, ctx) {
    ctx.update((s) => {
      const visible = selectVisibleIds(s);
      s.selection.ids = [...visible];
      if (!s.selection.activeId || !visible.includes(s.selection.activeId)) s.selection.activeId = visible[0] ?? null;
    });
  },
});

export const getSelection = defineAction({
  id: "library.selection.get",
  title: "Get Selection",
  description: "Return the active photo id and the selected photos with their metadata (rating, flag, label, capture time, EXIF).",
  category: "Library",
  kind: "query",
  run(_, ctx) {
    const { selection, photos } = ctx.state;
    return {
      activeId: selection.activeId,
      photos: selection.ids.map((id) => photos.byId[id]).filter((p) => !!p).map(publicPhoto),
    };
  },
});

export const listPhotos = defineAction({
  id: "library.photos.list",
  title: "List Photos",
  description:
    "Return photos in display order with their metadata, filtered by any combination of rating range, flags, " +
    "colour labels, capture-time range (camera local time) and path text. Independent of the on-screen filter " +
    "unless onlyVisible is true. Use it to find photos before acting on them by id.",
  category: "Library",
  kind: "query",
  params: z
    .object({
      minRating: z.number().int().min(0).max(5).optional().describe("Only photos rated at least this."),
      maxRating: z.number().int().min(0).max(5).optional().describe("Only photos rated at most this."),
      flags: z.array(flagSchema).optional().describe("Only photos with one of these flags."),
      colorLabels: z.array(labelSchema).optional().describe("Only photos with one of these labels."),
      capturedAfter: localTime.optional().describe("Only photos captured at or after this local time."),
      capturedBefore: localTime.optional().describe("Only photos captured before this local time."),
      text: z.string().optional().describe("Only photos whose path contains this text (case-insensitive)."),
      onlyVisible: z.boolean().optional().describe("Start from the photos the on-screen filter shows."),
      limit: z.number().int().min(1).max(10000).optional().describe("Return at most this many photos."),
    })
    .optional(),
  examples: [
    { params: { minRating: 4 }, description: "Photos rated 4 or 5 stars." },
    { params: { flags: ["reject"] }, description: "All rejected photos." },
    {
      params: { minRating: 4, capturedAfter: "2026-09-12T05:00", capturedBefore: "2026-09-12T12:00" },
      description: "4+ star photos from the morning of 12 September.",
    },
  ],
  run(params = {}, ctx) {
    const state = ctx.state;
    const ids = params.onlyVisible ? selectVisibleIds(state) : selectVisibleIds({ ...state, library: { ...state.library, filter: defaultFilter } });
    const filter = {
      minRating: params.minRating ?? 0,
      flags: params.flags ?? [],
      colorLabels: params.colorLabels ?? [],
      text: params.text ?? "",
    };
    const matches = ids
      .map((id) => state.photos.byId[id]!)
      .filter(
        (p) =>
          matchesFilter(p, filter) &&
          (params.maxRating === undefined || p.rating <= params.maxRating) &&
          (params.capturedAfter === undefined || p.capturedAt >= params.capturedAfter) &&
          (params.capturedBefore === undefined || p.capturedAt < params.capturedBefore),
      );
    return { total: matches.length, photos: matches.slice(0, params.limit ?? matches.length).map(publicPhoto) };
  },
});

/** Size presets for viewing photos, and how many fit in one call. */
const VIEW_SIZES = {
  thumbnail: { maxEdge: 512, maxPhotos: 24 },
  preview: { maxEdge: 1024, maxPhotos: 8 },
  detail: { maxEdge: 1568, maxPhotos: 3 },
} as const;

export const viewPhotos = defineAction({
  id: "library.photos.view",
  title: "View Photos",
  description:
    "Look at photos as images (for the AI): returns JPEGs of the given photos, with their current develop " +
    "edits applied unless original is true. Use thumbnail size to scan many photos (duplicates, obvious blur, " +
    "subjects), preview to judge a look or colour, detail to check focus. Viewing costs tokens: look only at " +
    "what the request needs. At most 24 thumbnails, 8 previews or 3 detail images per call.",
  category: "Library",
  kind: "query",
  params: z.object({
    photoIds: z.array(z.string()).min(1).max(24).describe("Photos to look at (ids from library.photos.list or the selection)."),
    size: z.enum(["thumbnail", "preview", "detail"]).optional().describe("thumbnail 512px, preview 1024px (default), detail 1568px."),
    original: z.boolean().optional().describe("Show the unedited photo instead of the current edit."),
  }),
  examples: [
    { params: { photoIds: ["DSC_0001.jpg"], size: "preview" }, description: "Look at one photo as currently edited." },
    { params: { photoIds: ["DSC_0001.jpg", "DSC_0002.jpg", "DSC_0003.jpg"], size: "thumbnail" }, description: "Compare a burst for the sharpest frame." },
  ],
  async run({ photoIds, size = "preview", original }, ctx) {
    const preset = VIEW_SIZES[size];
    if (photoIds.length > preset.maxPhotos) {
      throw new Error(`At most ${preset.maxPhotos} photos at ${size} size per call; split the request or use a smaller size.`);
    }
    targetIds(ctx.state, photoIds);
    const images = [];
    for (const id of photoIds) {
      images.push(await ctx.services.vision.capture(ctx.state.photos.byId[id]!, { maxEdge: preset.maxEdge, edited: !original }));
    }
    return { kind: "images" as const, images };
  },
});

// ── Culling ──────────────────────────────────────────────────────────────

export const setRating = defineAction({
  id: "library.rating.set",
  title: "Set Rating",
  description: "Set the star rating (0 = unrated, 1–5 stars) on the selected photos, or on specific photos by id.",
  category: "Library",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z.object({
    rating: z.number().int().min(0).max(5).describe("Stars, 0–5. 0 clears the rating."),
    photoIds,
    advance,
  }),
  examples: [
    { params: { rating: 3 }, description: "Give the selected photos 3 stars." },
    { params: { rating: 0, photoIds: ["DSC_0004.jpg"] }, description: "Clear the rating of one specific photo." },
  ],
  defaultShortcuts: [0, 1, 2, 3, 4, 5].map((rating) => ({ keys: String(rating), params: { rating } })),
  label: ({ rating }) => (rating === 0 ? "Clear Rating" : `Rate ${"★".repeat(rating)}`),
  async run({ rating, photoIds, advance }, ctx) {
    const ids = targetIds(ctx.state, photoIds);
    ctx.update((s) => {
      for (const id of ids) s.photos.byId[id]!.rating = rating;
    });
    const advanced = await maybeAdvance(ctx, advance, !photoIds && ids.length === 1);
    return { changed: ids.length, advanced };
  },
});

const FLAG_LABELS = { pick: "Flag as Pick", reject: "Flag as Rejected", none: "Remove Flag" } as const;

export const setFlag = defineAction({
  id: "library.flag.set",
  title: "Set Flag",
  description: "Flag the selected photos (or specific photos by id) as pick, reject, or none to clear the flag.",
  category: "Library",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z.object({
    flag: flagSchema.describe("pick keeps, reject discards, none clears."),
    photoIds,
    advance,
  }),
  examples: [
    { params: { flag: "pick" }, description: "Pick the selected photos." },
    { params: { flag: "reject", photoIds: ["DSC_0007.jpg", "DSC_0008.jpg"] }, description: "Reject two specific photos." },
  ],
  defaultShortcuts: [
    { keys: "p", params: { flag: "pick" } },
    { keys: "x", params: { flag: "reject" } },
    { keys: "u", params: { flag: "none" } },
  ],
  label: ({ flag }) => FLAG_LABELS[flag],
  async run({ flag, photoIds, advance }, ctx) {
    const ids = targetIds(ctx.state, photoIds);
    ctx.update((s) => {
      for (const id of ids) s.photos.byId[id]!.flag = flag;
    });
    const advanced = await maybeAdvance(ctx, advance, !photoIds && ids.length === 1);
    return { changed: ids.length, advanced };
  },
});

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const setColorLabel = defineAction({
  id: "library.colorLabel.set",
  title: "Set Color Label",
  description: "Apply a colour label to the selected photos (or specific photos by id). Use none to remove it.",
  category: "Library",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z.object({ label: labelSchema.describe("Colour label, or none."), photoIds, advance }),
  examples: [
    { params: { label: "red" }, description: "Label the selection red." },
    { params: { label: "none", photoIds: ["DSC_0002.jpg"] }, description: "Remove the label from one photo." },
  ],
  label: ({ label }) => (label === "none" ? "Remove Color Label" : `Label ${capitalize(label)}`),
  async run({ label, photoIds, advance }, ctx) {
    const ids = targetIds(ctx.state, photoIds);
    ctx.update((s) => {
      for (const id of ids) s.photos.byId[id]!.colorLabel = label;
    });
    const advanced = await maybeAdvance(ctx, advance, !photoIds && ids.length === 1);
    return { changed: ids.length, advanced };
  },
});

export const toggleColorLabel = defineAction({
  id: "library.colorLabel.toggle",
  title: "Toggle Color Label",
  description:
    "Lightroom-style label key: apply the label to the selected photos, or remove it if the active photo " +
    "already has that label.",
  category: "Library",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z.object({
    label: labelSchema.refine((l) => l !== "none", "Use a colour").describe("Colour label to toggle."),
    advance,
  }),
  examples: [{ params: { label: "red" }, description: "Toggle red on the selection." }],
  defaultShortcuts: [
    { keys: "6", params: { label: "red" } },
    { keys: "7", params: { label: "yellow" } },
    { keys: "8", params: { label: "green" } },
    { keys: "9", params: { label: "blue" } },
  ],
  label: ({ label }) => `Toggle ${capitalize(label)} Label`,
  async run({ label, advance }, ctx) {
    const ids = targetIds(ctx.state, undefined);
    const active = ctx.state.selection.activeId ? ctx.state.photos.byId[ctx.state.selection.activeId] : undefined;
    const next = active?.colorLabel === label ? "none" : label;
    ctx.update((s) => {
      for (const id of ids) s.photos.byId[id]!.colorLabel = next;
    });
    const advanced = await maybeAdvance(ctx, advance, ids.length === 1);
    return { changed: ids.length, label: next, advanced };
  },
});

// ── Filter & sort ────────────────────────────────────────────────────────

export const setFilter = defineAction({
  id: "library.filter.set",
  title: "Filter Photos",
  description:
    "Change which photos are shown. Given fields replace the current ones; omitted fields keep their value. " +
    "Flags and colour labels match any of the listed values; an empty list means any.",
  category: "Library",
  kind: "command",
  params: z.object({
    minRating: z.number().int().min(0).max(5).optional().describe("Show photos rated at least this; 0 for any."),
    flags: z.array(flagSchema).optional().describe("Show only these flags; [] for any."),
    colorLabels: z.array(labelSchema).optional().describe("Show only these labels; [] for any."),
    text: z.string().optional().describe("Show only paths containing this text; empty for any."),
  }),
  examples: [
    { params: { minRating: 4 }, description: "Show 4+ star photos." },
    { params: { flags: ["pick"] }, description: "Show picks only." },
    { params: { flags: ["pick", "none"] }, description: "Hide rejects." },
  ],
  label: (p) =>
    p.minRating !== undefined && Object.keys(p).length === 1
      ? p.minRating === 0
        ? "Show Any Rating"
        : `Show ${"★".repeat(p.minRating)} and Up`
      : "Filter Photos",
  run(params, ctx) {
    ctx.update((s) => {
      s.library.filter = { ...s.library.filter, ...params };
    });
    return { visible: selectVisibleIds(ctx.state).length };
  },
});

export const clearFilter = defineAction({
  id: "library.filter.clear",
  title: "Clear Filter",
  description: "Remove every filter (rating, flags, labels, text) so all photos in the folder are shown again.",
  category: "Library",
  kind: "command",
  defaultShortcuts: [{ keys: "mod+l" }],
  run(_, ctx) {
    ctx.update((s) => {
      s.library.filter = defaultFilter;
    });
  },
});

export const setSort = defineAction({
  id: "library.sort.set",
  title: "Sort Photos",
  description: "Choose the display order: capture time, file name, rating or file size, ascending or descending.",
  category: "Library",
  kind: "command",
  params: z.object({
    key: z.enum(["capturedAt", "fileName", "rating", "size"]).describe("What to sort by."),
    direction: z.enum(["asc", "desc"]).default("asc").describe("asc: oldest/A/lowest first."),
  }),
  examples: [
    { params: { key: "capturedAt", direction: "asc" }, description: "Oldest first." },
    { params: { key: "rating", direction: "desc" }, description: "Best rated first." },
  ],
  run({ key, direction }, ctx) {
    ctx.update((s) => {
      s.library.sort = { key, direction };
    });
  },
});

export const libraryActions = [
  openFolder,
  reconnectFolder,
  openRecentFolder,
  recentFolders,
  openSample,
  restoreFolder,
  applyIndex,
  setSelection,
  selectAll,
  getSelection,
  listPhotos,
  viewPhotos,
  setRating,
  setFlag,
  setColorLabel,
  toggleColorLabel,
  setFilter,
  clearFilter,
  setSort,
];
