import type { ColorLabel } from "../../core/state/types";
import { useAppState, useAvailable, useDispatch } from "../hooks";
import { Icon } from "./Icon";
import styles from "./CullBar.module.css";

const LABELS: Array<Exclude<ColorLabel, "none">> = ["red", "yellow", "green", "blue", "purple"];

/**
 * Rating, flags, colour labels and auto-advance as buttons: what the number
 * and letter keys do, for devices without a keyboard. Acts on the selection,
 * like the keys; shows the active photo's state. Tapping the current value
 * again clears it.
 */
export function CullBar() {
  const active = useAppState((s) => (s.selection.activeId ? s.photos.byId[s.selection.activeId] : undefined));
  const autoAdvance = useAppState((s) => s.autoAdvance);
  const canRate = useAvailable("library.rating.set");
  const dispatch = useDispatch();
  if (!active) return null;

  const rating = active.rating;
  const advancing = autoAdvance === "always";

  return (
    <div className={styles.bar} role="toolbar" aria-label="Rate and flag">
      <div className={styles.group} role="group" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`${styles.button} ${styles.star} ${n <= rating ? styles.starOn : ""}`}
            aria-label={n === rating ? `${n} stars (tap to clear)` : `${n} stars`}
            aria-pressed={n <= rating}
            disabled={!canRate}
            onClick={() => void dispatch("library.rating.set", { rating: n === rating ? 0 : n })}
          >
            ★
          </button>
        ))}
      </div>

      <div className={styles.group} role="group" aria-label="Flag">
        <button
          type="button"
          className={`${styles.button} ${styles.pick}`}
          aria-label={active.flag === "pick" ? "Picked (tap to unflag)" : "Pick"}
          aria-pressed={active.flag === "pick"}
          disabled={!canRate}
          onClick={() => void dispatch("library.flag.set", { flag: active.flag === "pick" ? "none" : "pick" })}
        >
          <Icon name="flag" size={18} />
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.reject}`}
          aria-label={active.flag === "reject" ? "Rejected (tap to unflag)" : "Reject"}
          aria-pressed={active.flag === "reject"}
          disabled={!canRate}
          onClick={() => void dispatch("library.flag.set", { flag: active.flag === "reject" ? "none" : "reject" })}
        >
          <Icon name="reject" size={18} />
        </button>
      </div>

      <div className={styles.group} role="group" aria-label="Colour label">
        {LABELS.map((label) => (
          <button
            key={label}
            type="button"
            className={`${styles.button} ${styles.swatchButton}`}
            aria-label={active.colorLabel === label ? `${label} label (tap to remove)` : `${label} label`}
            aria-pressed={active.colorLabel === label}
            disabled={!canRate}
            onClick={() => void dispatch("library.colorLabel.toggle", { label })}
          >
            <span className={styles.swatch} style={{ background: `var(--label-${label})` }} />
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`${styles.button} ${styles.advance}`}
        aria-label={advancing ? "Auto-advance is on: rating or flagging moves to the next photo" : "Auto-advance is off"}
        aria-pressed={advancing}
        // Off restores the default (Caps Lock on a keyboard), so a desktop session keeps its behaviour.
        onClick={() => void dispatch("app.autoAdvance.set", { mode: advancing ? "capsLock" : "always" })}
      >
        <Icon name="advance" size={18} />
      </button>
    </div>
  );
}
