import { PROFILES_SETTINGS_KEY } from "../../actions/profiles";
import type { Runtime } from "../../core/runtime";

/**
 * Loads the user's profiles from local settings, then saves them whenever
 * they change, by any cause (a command, undo, an import). AI previews are
 * never saved.
 */
export async function syncProfiles(runtime: Runtime): Promise<() => void> {
  const { store, services } = runtime;
  const stored = await services.settings.get<unknown>(PROFILES_SETTINGS_KEY);
  if (Array.isArray(stored) && stored.length) {
    await runtime.dispatch("develop.profiles.load", { profiles: stored }, { source: "script" });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let saved = store.getState().develop.profiles;
  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    const { develop, ai } = store.getState();
    if (ai.previewing || develop.profiles === saved) return;
    saved = develop.profiles;
    void services.settings.set(PROFILES_SETTINGS_KEY, saved);
  };
  const flush = () => timer !== undefined && save();
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", flush);

  const unsubscribe = store.subscribe((state, prev) => {
    // Ending a preview restores the snapshot, so a previewed change never gets here as "saved".
    if (state.develop.profiles !== prev.develop.profiles || state.ai.previewing !== prev.ai.previewing) {
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
