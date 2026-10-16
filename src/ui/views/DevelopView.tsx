import { useAppState, useShortcut } from "../hooks";
import { Kbd } from "../shell/Kbd";
import { Filmstrip } from "./Filmstrip";
import { PhotoStage } from "./PhotoStage";
import styles from "./DevelopView.module.css";

export function DevelopView() {
  const beforeAfter = useAppState((s) => s.beforeAfter);
  const filmstrip = useAppState((s) => s.filmstrip);
  const toggle = useShortcut("view.beforeAfter.toggle");

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <PhotoStage dimmed={beforeAfter} badge={beforeAfter ? "Before" : undefined} />
        {filmstrip && <Filmstrip />}
      </div>
      <aside className={styles.panel} aria-label="Develop controls">
        <h2 className={styles.heading}>Develop</h2>
        <p className={styles.note}>Adjustments (exposure, white balance, tone curve, HSL…) arrive in Phase 3.</p>
        <p className={styles.note}>
          Toggle before/after with {toggle ? <Kbd strokes={toggle.strokes} /> : "the command palette"}.
        </p>
      </aside>
    </div>
  );
}
