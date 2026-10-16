import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import type { DispatchResult, DispatchSource } from "../../core/actions/types";
import type { HistorySnapshot } from "../../core/history/history";
import type { ResolvedBinding } from "../../core/keybindings/service";
import type { AppState } from "../../core/state/types";
import { useRuntime } from "../runtime-context";
import { toast } from "../toasts";

export function useAppState<T>(selector: (s: AppState) => T): T {
  return useStore(useRuntime().store, selector);
}

export function useHistory(): HistorySnapshot {
  const { history } = useRuntime();
  return useSyncExternalStore(history.subscribe, history.getSnapshot);
}

/** Re-renders when keybindings change; returns a version number to use as a memo key. */
export function useBindingsVersion(): number {
  const { keybindings } = useRuntime();
  return useSyncExternalStore(keybindings.subscribe, keybindings.getVersion);
}

export function usePendingChord(): string | null {
  const { keybindings } = useRuntime();
  return useSyncExternalStore(keybindings.subscribePending, () => keybindings.pendingChord);
}

/** Whether an action's `when` holds right now. Tracks both state and history. */
export function useAvailable(actionId: string): boolean {
  const { store, history, dispatcher } = useRuntime();
  const subscribe = useCallback(
    (cb: () => void) => {
      const a = store.subscribe(cb);
      const b = history.subscribe(cb);
      return () => {
        a();
        b();
      };
    },
    [store, history],
  );
  return useSyncExternalStore(subscribe, () => dispatcher.isAvailable(actionId));
}

/** Current binding for an action (matching params, if given), in display form. */
export function useShortcut(actionId: string, params?: unknown): { binding: ResolvedBinding; strokes: string[] } | null {
  const { keybindings } = useRuntime();
  const version = useBindingsVersion();
  const paramsKey = JSON.stringify(params);
  return useMemo(() => {
    void version;
    const binding = keybindings
      .bindingsFor(actionId)
      .find((b) => JSON.stringify(b.params) === paramsKey);
    return binding ? { binding, strokes: keybindings.formatStrokes(binding.keys) } : null;
  }, [keybindings, actionId, paramsKey, version]);
}

/** Dispatch helper for UI controls: failures surface as a toast. */
export function useDispatch(source: DispatchSource = "ui") {
  const runtime = useRuntime();
  return useCallback(
    async <R = unknown>(id: string, params?: unknown): Promise<DispatchResult<R>> => {
      const result = await runtime.dispatch<R>(id, params, { source });
      if (!result.ok) toast(result.message, "error");
      return result;
    },
    [runtime, source],
  );
}
