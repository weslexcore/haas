import { useEffect } from "react";
import { useAppState } from "./hooks";
import { useCoarsePointer, useMobileLayout } from "./hooks/media";
import { trackModifiers } from "./input-store";
import { ContextMenu } from "./menus/ContextMenu";
import { AiPanel } from "./ai/AiPanel";
import { AiSettings } from "./ai/AiSettings";
import { CommandPalette } from "./palette/CommandPalette";
import { useRuntime } from "./runtime-context";
import { toast } from "./toasts";
import { ShortcutsSettings } from "./settings/ShortcutsSettings";
import { CullBar } from "./shell/CullBar";
import { MobileNav } from "./shell/MobileNav";
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
  // Small screens get a bottom bar instead of the status bar; touch devices get rating buttons (no keys to press).
  const mobile = useMobileLayout();
  const touch = useCoarsePointer();
  // The CSS modules follow the same decision (e.g. where toasts and dialogs go).
  useEffect(() => {
    document.documentElement.dataset.layout = mobile ? "mobile" : "desktop";
  }, [mobile]);

  return (
    <div className={styles.app} data-layout={mobile ? "mobile" : "desktop"}>
      <TopBar />
      <main className={styles.main} aria-label={`${view} view`}>
        <LibraryGate>{view === "grid" ? <GridView /> : view === "loupe" ? <LoupeView /> : <DevelopView />}</LibraryGate>
      </main>
      {touch && <CullBar />}
      {mobile ? <MobileNav /> : <StatusBar />}
      <CommandPalette />
      <ShortcutsSettings />
      <ContextMenu />
      <AiPanel />
      <AiSettings />
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
      const { palette, shortcutsOpen, contextMenu, ai } = store.getState();
      keybindings.handleKeyDown(e, { modalOpen: palette.open || shortcutsOpen || contextMenu !== null || ai.settingsOpen });
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
        if (!result.ok || !["library.rejected.remove", "library.removed.restore", "library.removed.empty", "develop.export", "app.account.passkey.add"].includes(id)) return;
        const v = (result.value ?? {}) as {
          removed?: number;
          restored?: number;
          deleted?: number;
          exported?: number;
          destination?: string;
          failed?: Array<{ path: string; error: string }>;
        };
        const n = (k: number) => (k === 1 ? "1 photo" : `${k} photos`);
        if (id === "library.rejected.remove" && v.removed) toast(`Moved ${n(v.removed)} to the _Rejected folder. Undo brings them back.`);
        if (id === "library.removed.restore" && v.restored) toast(`Restored ${n(v.restored)}.`);
        if (id === "app.account.passkey.add") toast("Passkey added. Next time, sign in with it.");
        if (id === "library.removed.empty") toast(`Permanently deleted ${n(v.deleted ?? 0)}.`);
        if (id === "develop.export" && v.exported) {
          toast(v.destination === "folder" ? `Exported ${n(v.exported)} to the _Exports folder.` : `Exported ${n(v.exported)} as downloads.`);
        }
        if (v.failed?.length) {
          toast(`${v.failed.length} file(s) failed: ${v.failed.slice(0, 3).map((f) => `${f.path} (${f.error})`).join("; ")}`, "error", 10000);
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
