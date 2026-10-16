import { useEffect } from "react";
import { useAppState } from "./hooks";
import { trackModifiers } from "./input-store";
import { ContextMenu } from "./menus/ContextMenu";
import { CommandPalette } from "./palette/CommandPalette";
import { useRuntime } from "./runtime-context";
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
