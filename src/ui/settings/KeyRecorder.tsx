import { useEffect, useRef, useState } from "react";
import { strokeFromEvent } from "../../core/keybindings/combo";
import { useRuntime } from "../runtime-context";
import { Kbd } from "../shell/Kbd";
import styles from "./ShortcutsSettings.module.css";

const CHORD_WAIT_MS = 900;
const MAX_STROKES = 2;

interface KeyRecorderProps {
  onCommit: (keys: string) => void;
  onCancel: () => void;
}

/**
 * Captures the next key combo. A second stroke within ~1s makes a chord.
 * Enter commits early; Esc (before any key) cancels. App shortcuts are
 * suspended while recording.
 */
export function KeyRecorder({ onCommit, onCancel }: KeyRecorderProps) {
  const { keybindings, platform } = useRuntime();
  const [strokes, setStrokes] = useState<string[]>([]);
  const callbacks = useRef({ onCommit, onCancel });
  callbacks.current = { onCommit, onCancel };

  useEffect(() => {
    keybindings.setSuspended(true);
    let recorded: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const commit = () => {
      clearTimeout(timer);
      if (recorded.length) callbacks.current.onCommit(recorded.join(" "));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && recorded.length === 0) return callbacks.current.onCancel();
      if (e.key === "Enter" && recorded.length > 0) return commit();
      const stroke = strokeFromEvent(e, platform.isMac);
      if (!stroke) return;
      recorded = [...recorded, stroke];
      setStrokes(recorded);
      clearTimeout(timer);
      if (recorded.length >= MAX_STROKES) commit();
      else timer = setTimeout(commit, CHORD_WAIT_MS);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      clearTimeout(timer);
      keybindings.setSuspended(false);
    };
  }, [keybindings, platform]);

  return (
    <span className={styles.recorder} role="status" aria-live="assertive">
      {strokes.length ? (
        <Kbd strokes={keybindings.formatStrokes(strokes.join(" "))} />
      ) : (
        "Press keys…"
      )}
      <span className={styles.recorderHint}>{strokes.length ? "another key for a chord" : "Esc to cancel"}</span>
    </span>
  );
}
