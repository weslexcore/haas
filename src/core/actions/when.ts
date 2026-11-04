import type { ViewMode } from "../state/types";
import type { ReadonlyContext } from "./types";

/**
 * An availability condition that carries its own plain-language description,
 * so the manifest can explain it without serialising a function.
 */
export interface WhenClause {
  test(ctx: ReadonlyContext): boolean;
  /** Phrase that completes "Available when …", e.g. "at least one photo is selected". */
  describe: string;
}

export function when(describe: string, test: (ctx: ReadonlyContext) => boolean): WhenClause {
  return { describe, test };
}

const VIEW_NAMES: Record<ViewMode, string> = { grid: "Grid", loupe: "Loupe", develop: "Develop" };

export const inView = (...views: ViewMode[]): WhenClause =>
  when(
    `the current view is ${views.map((v) => VIEW_NAMES[v]).join(" or ")}`,
    (ctx) => views.includes(ctx.state.view),
  );

export const hasPhotos = when("the library contains photos", (ctx) => ctx.state.photos.order.length > 0);

export const hasSelection = when(
  "at least one photo is selected",
  (ctx) => ctx.state.selection.ids.length > 0,
);

export const paletteOpen = when("the command palette is open", (ctx) => ctx.state.palette.open);

export const shortcutsOpen = when(
  "the Keyboard Shortcuts screen is open",
  (ctx) => ctx.state.shortcutsOpen,
);

export const canUndo = when("there is an action to undo", (ctx) => ctx.history.canUndo);
export const canRedo = when("there is an undone action to redo", (ctx) => ctx.history.canRedo);

export function all(...clauses: WhenClause[]): WhenClause {
  return when(
    clauses.map((c) => c.describe).join(" and "),
    (ctx) => clauses.every((c) => c.test(ctx)),
  );
}

export function any(...clauses: WhenClause[]): WhenClause {
  return when(
    clauses.map((c) => c.describe).join(" or "),
    (ctx) => clauses.some((c) => c.test(ctx)),
  );
}

export function not(clause: WhenClause): WhenClause {
  return when(`it is not the case that ${clause.describe}`, (ctx) => !clause.test(ctx));
}

export const hasActivePhoto = when("a photo is active", (ctx) => !!ctx.state.selection.activeId);

export const signedIn = when("the user is signed in to a Photon account", (ctx) => ctx.state.account !== null);

export const contextMenuOpen = when("a context menu is open", (ctx) => ctx.state.contextMenu !== null);

export const needsPermission = when(
  "the last folder needs permission to be reopened",
  (ctx) => ctx.state.library.status.kind === "needsPermission",
);

export const folderWritable = when(
  "the folder was opened with write access",
  (ctx) => !!ctx.state.library.folder?.writable,
);

export const hasRejected = when("at least one photo is flagged rejected", (ctx) =>
  ctx.state.photos.order.some((id) => ctx.state.photos.byId[id]?.flag === "reject"),
);

export const hasRemoved = when(
  "the folder's _Rejected subfolder contains removed photos",
  (ctx) => ctx.state.library.removedCount > 0,
);
