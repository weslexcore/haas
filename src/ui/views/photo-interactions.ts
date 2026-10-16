import { useCallback, type MouseEvent } from "react";
import { selectVisibleIds } from "../../core/state/selectors";
import { useRuntime } from "../runtime-context";
import { toast } from "../toasts";

/**
 * Click and right-click handling shared by the grid and filmstrip. Turning
 * mouse input into a selection is UI work; every change is an action.
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

  const openMenu = useCallback(
    async (e: MouseEvent, id: string) => {
      e.preventDefault();
      // Like Lightroom: right-clicking outside the selection selects that photo first.
      if (!runtime.store.getState().selection.ids.includes(id)) {
        if (!(await dispatch("library.selection.set", { ids: [id] }))) return;
      }
      void dispatch("app.contextMenu.open", { menuId, x: e.clientX, y: e.clientY });
    },
    [runtime, dispatch, menuId],
  );

  return { select, openMenu, dispatch };
}
