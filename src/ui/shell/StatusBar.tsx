import { useStore } from "zustand";
import { selectLibraryIds, selectVisibleIds } from "../../core/state/selectors";
import { useAppState, useHistory, usePendingChord, useShortcut } from "../hooks";
import { inputStore } from "../input-store";
import { useRuntime } from "../runtime-context";
import { FlagMark, LabelDot, Stars } from "../views/PhotoMeta";
import { ExportProgress } from "./ExportProgress";
import { Kbd } from "./Kbd";
import styles from "./StatusBar.module.css";

export function StatusBar() {
  const { keybindings } = useRuntime();
  const count = useAppState((s) => selectLibraryIds(s).length);
  const shown = useAppState((s) => selectVisibleIds(s).length);
  const selected = useAppState((s) => s.selection.ids.length);
  const status = useAppState((s) => s.library.status);
  const folder = useAppState((s) => s.library.folder);
  const active = useAppState((s) => (s.selection.activeId ? s.photos.byId[s.selection.activeId] : undefined));
  const autoAdvance = useAppState((s) => s.autoAdvance);
  const capsLock = useStore(inputStore, (s) => s.capsLock);
  const history = useHistory();
  const undoShortcut = useShortcut("history.undo");
  const pending = usePendingChord();
  const advancing = autoAdvance === "always" || (autoAdvance === "capsLock" && capsLock);

  return (
    <footer className={styles.bar}>
      {folder && (
        <span className={styles.folder} title={folder.writable ? "XMP sidecars are written to this folder" : "Ratings are saved in the app only"}>
          {folder.name}
          {folder.kind !== "sample" && !folder.writable && " (read-only)"}
        </span>
      )}
      {count > 0 && (
        <span>
          {shown === count ? `${count} photos` : `${shown} of ${count} photos`} · {selected} selected
        </span>
      )}
      {status.kind === "indexing" && (
        <span role="status">
          Reading EXIF {status.done}/{status.total}
        </span>
      )}
      <ExportProgress />
      {active && (
        <span className={styles.active}>
          <span>{active.fileName}</span>
          <Stars rating={active.rating} />
          <LabelDot label={active.colorLabel} />
          <FlagMark flag={active.flag} />
        </span>
      )}
      <span className={styles.spacer} />
      {pending && (
        <span className={styles.pending} role="status">
          <Kbd strokes={keybindings.formatStrokes(pending)} /> …
        </span>
      )}
      {advancing && (
        <span className={styles.advance} role="status" title={autoAdvance === "always" ? "Auto-advance is always on" : "Caps Lock is on: rating or flagging moves to the next photo"}>
          ⇥ Auto-advance
        </span>
      )}
      <span role="status" aria-live="polite">
        {history.undoLabel && (
          <>
            Last change: {history.undoLabel}
            {undoShortcut && (
              <>
                {" "}
                · <Kbd strokes={undoShortcut.strokes} /> to undo
              </>
            )}
          </>
        )}
      </span>
    </footer>
  );
}
