import { useCallback, type MouseEvent } from "react";
import { selectVisibleIds } from "../../core/state/selectors";
import type { Point } from "../hooks/gestures";
import { useRuntime } from "../runtime-context";
import { toast } from "../toasts";

/**
 * Click, right-click and long-press handling shared by the grid and
 * filmstrip. Turning pointer input into a selection is UI work; every change
 * is an action.
 */
export function usePhotoInteractions(menuId: string) {
  const runtime = useRuntime();

  const dispatch = useCallback(
    async (id: string, params?: unknown) => {
      const r = await runtime.dispatch(id, params, { source: "ui" });
      if (!r.ok) toast(r.message, "error");
      return r.ok;
    },
    [runtime],
  );

  const select = useCallback(
    (e: MouseEvent, id: string) => {
      const state = runtime.store.getState();
      const { activeId, ids } = state.selection;
      const additive = runtime.platform.isMac ? e.metaKey : e.ctrlKey;
      let next: string[];
      if (e.shiftKey && activeId) {
        const order = selectVisibleIds(state);
        const [a, b] = [order.indexOf(activeId), order.indexOf(id)].sort((x, y) => x - y);
        next = a! < 0 ? [id] : order.slice(a, b! + 1);
      } else if (additive) {
        next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
        if (!next.length) next = [id];
      } else {
        next = [id];
      }
      void dispatch("library.selection.set", { ids: next, activeId: next.includes(id) ? id : next[0] });
    },
    [runtime, dispatch],
  );

  /** Opens the photo menu at a point: a right-click, or a long press on touch screens. */
  const openMenuAt = useCallback(
    async (id: string, at: Point) => {
      // Like Lightroom: opening the menu outside the selection selects that photo first.
      if (!runtime.store.getState().selection.ids.includes(id)) {
        if (!(await dispatch("library.selection.set", { ids: [id] }))) return;
      }
      void dispatch("app.contextMenu.open", { menuId, x: at.x, y: at.y });
    },
    [runtime, dispatch, menuId],
  );

  const openMenu = useCallback(
    (e: MouseEvent, id: string) => {
      if (e.defaultPrevented) return; // a long press already opened it
      e.preventDefault();
      void openMenuAt(id, { x: e.clientX, y: e.clientY });
    },
    [openMenuAt],
  );

  return { select, openMenu, openMenuAt, dispatch };
}
