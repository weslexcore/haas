import type { Runtime } from "../core/runtime";
import type { AppState, ViewMode } from "../core/state/types";

/**
 * Keeps the current folder, view and active photo in the URL
 * (?folder=…&view=loupe&photo=2026-09/DSC_0001.jpg), so reloading or sharing
 * the link returns to the same place.
 *
 * - View changes push a history entry (browser Back returns to the grid);
 *   photo changes replace it (browsing 500 photos doesn't fill history).
 * - On load, the view and photo are restored once the folder named in the
 *   URL has loaded. A link for another folder is ignored.
 * - Changes go through actions, like any other input.
 */

const VIEWS: readonly ViewMode[] = ["grid", "loupe", "develop"];

interface UrlState {
  folder: string | null;
  view: ViewMode | null;
  photo: string | null;
}

export function readUrlState(search = window.location.search): UrlState {
  const p = new URLSearchParams(search);
  const view = p.get("view");
  return {
    folder: p.get("folder"),
    view: VIEWS.includes(view as ViewMode) ? (view as ViewMode) : null,
    photo: p.get("photo"),
  };
}

function urlFor(state: AppState): string {
  const p = new URLSearchParams(window.location.search);
  const set = (k: string, v: string | null) => (v ? p.set(k, v) : p.delete(k));
  set("folder", state.library.folder?.id ?? null);
  set("view", state.library.folder ? state.view : null);
  set("photo", state.selection.activeId);
  const query = p.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
}

/** Apply a URL state once its folder is loaded. Returns true when done (applied or not applicable). */
async function apply(runtime: Runtime, target: UrlState): Promise<boolean> {
  const state = runtime.store.getState();
  const folder = state.library.folder;
  const status = state.library.status.kind;
  if (!folder || status === "loading" || status === "empty") return false; // not loaded yet: wait
  if (folder.id !== target.folder) return status !== "needsPermission"; // another folder is open: give up
  if (state.photos.order.length === 0) return status !== "indexing";
  if (target.photo && state.photos.byId[target.photo] && state.selection.activeId !== target.photo) {
    await runtime.dispatch("library.selection.set", { ids: [target.photo] }, { source: "ui" });
  }
  if (target.view && state.view !== target.view) {
    await runtime.dispatch("view.set", { view: target.view }, { source: "ui" });
  }
  return true;
}

export function syncUrlState(runtime: Runtime): () => void {
  let pending: UrlState | null = readUrlState();
  let restoring = false;
  if (!pending.folder) pending = null;

  const writeUrl = (push: boolean) => {
    const url = urlFor(runtime.store.getState());
    if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  };

  const tryRestore = async () => {
    if (!pending || restoring) return;
    restoring = true;
    try {
      if (await apply(runtime, pending)) {
        pending = null;
        writeUrl(false); // now describe what is actually shown
      }
    } finally {
      restoring = false;
    }
  };

  const unsubscribe = runtime.store.subscribe((state, prev) => {
    if (pending) {
      // Don't overwrite the URL until the state it describes has been restored.
      void tryRestore();
      if (pending) return;
    }
    if (state.view === prev.view && state.selection.activeId === prev.selection.activeId && state.library.folder?.id === prev.library.folder?.id) return;
    writeUrl(state.view !== prev.view && !!prev.library.folder);
  });

  // Back/forward: go to the view and photo in that history entry.
  const onPopState = () => {
    pending = readUrlState();
    if (!pending.folder) pending = null;
    void tryRestore();
  };
  window.addEventListener("popstate", onPopState);
  void tryRestore();

  return () => {
    unsubscribe();
    window.removeEventListener("popstate", onPopState);
  };
}
