import { useEffect } from "react";
import { useAppState } from "./hooks";
import { trackModifiers } from "./input-store";
import { ContextMenu } from "./menus/ContextMenu";
import { CommandPalette } from "./palette/CommandPalette";
import { useRuntime } from "./runtime-context";
import { toast } from "./toasts";
import { ShortcutsSettings } from "./settings/ShortcutsSettings";
import { StatusBar } from "./shell/StatusBar";
import { Toasts } from "./shell/Toasts";
import { TopBar } from "./shell/TopBar";
import { DevelopView } from "./views/DevelopView";
import { GridView } from "./views/GridView";
import { LibraryGate } from "./views/LibraryGate";
import { LoupeView } from "./views/LoupeView";
import styles from "./App.module.css";

export function App() {
  useKeyboardHost();
  useResultToasts();
  useThemeAttribute();
  const view = useAppState((s) => s.view);

  return (
    <div className={styles.app}>
      <TopBar />
      <main className={styles.main} aria-label={`${view} view`}>
        <LibraryGate>{view === "grid" ? <GridView /> : view === "loupe" ? <LoupeView /> : <DevelopView />}</LibraryGate>
      </main>
      <StatusBar />
      <CommandPalette />
      <ShortcutsSettings />
      <ContextMenu />
      <Toasts />
    </div>
  );
}

/** Routes every keydown through the keybinding service, and tracks Caps Lock for auto-advance. */
function useKeyboardHost() {
  const runtime = useRuntime();
  useEffect(() => {
    const { keybindings, store } = runtime;
    const onKeyDown = (e: KeyboardEvent) => {
      trackModifiers(runtime, e);
      if (e.defaultPrevented || e.isComposing) return;
      const { palette, shortcutsOpen, contextMenu } = store.getState();
      keybindings.handleKeyDown(e, { modalOpen: palette.open || shortcutsOpen || contextMenu !== null });
    };
    const onModifiers = (e: KeyboardEvent | MouseEvent) => trackModifiers(runtime, e);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onModifiers);
    window.addEventListener("pointerdown", onModifiers, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onModifiers);
      window.removeEventListener("pointerdown", onModifiers, true);
    };
  }, [runtime]);
}

/** Confirm file operations, whichever way they were started (keyboard, menu, palette, AI). */
function useResultToasts() {
  const { dispatcher } = useRuntime();
  useEffect(
    () =>
      dispatcher.onDispatch(({ id, result }) => {
        if (!result.ok || !["library.rejected.remove", "library.removed.restore", "library.removed.empty"].includes(id)) return;
        const v = (result.value ?? {}) as { removed?: number; restored?: number; deleted?: number; failed?: Array<{ path: string; error: string }> };
        const n = (k: number) => (k === 1 ? "1 photo" : `${k} photos`);
        if (id === "library.rejected.remove" && v.removed) toast(`Moved ${n(v.removed)} to the _Rejected folder. Restore them any time from the filter bar.`);
        if (id === "library.removed.restore" && v.restored) toast(`Restored ${n(v.restored)}.`);
        if (id === "library.removed.empty") toast(`Permanently deleted ${n(v.deleted ?? 0)}.`);
        if (v.failed?.length) {
          toast(`${v.failed.length} file(s) couldn't be moved: ${v.failed.slice(0, 3).map((f) => `${f.path} (${f.error})`).join("; ")}`, "error", 10000);
        }
      }),
    [dispatcher],
  );
}

/** Applies the theme preference as data-theme on <html>, following the OS when set to "system". */
function useThemeAttribute() {
  const theme = useAppState((s) => s.theme);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = theme === "system" ? (query.matches ? "dark" : "light") : theme;
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme]);
}
