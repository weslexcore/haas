import type { Runtime } from "../../core/runtime";

const key = (folderId: string) => `ai.thread.${folderId}`;

/** Saves the AI conversation per folder and loads it when a folder opens. */
export function syncAiThread(runtime: Runtime): () => void {
  const { store, services } = runtime;
  let folderId: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    if (folderId) void services.settings.set(key(folderId), store.getState().ai.thread);
  };
  // Don't lose the latest turn or status change if the tab closes right away.
  const flush = () => timer !== undefined && save();
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", flush);

  const unsubscribe = store.subscribe((state, prev) => {
    const id = state.library.folder?.id ?? null;
    if (id !== folderId) {
      folderId = id;
      clearTimeout(timer);
      if (!id) return;
      void services.settings.get<unknown>(key(id)).then((turns) => {
        if (store.getState().library.folder?.id !== id) return;
        void runtime.dispatch("app.ai.thread.set", { turns: Array.isArray(turns) ? turns : [] }, { source: "script" });
      });
      return;
    }
    if (id && state.ai.thread !== prev.ai.thread) {
      clearTimeout(timer);
      timer = setTimeout(save, 200);
    }
  });
  return () => {
    unsubscribe();
    window.removeEventListener("pagehide", flush);
    document.removeEventListener("visibilitychange", flush);
  };
}
