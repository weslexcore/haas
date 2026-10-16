import styles from "./Kbd.module.css";

/** A shortcut rendered as key caps, one per chord stroke. */
export function Kbd({ strokes, className }: { strokes: string[]; className?: string }) {
  return (
    <span className={`${styles.combo} ${className ?? ""}`} aria-label={`Shortcut: ${strokes.join(" then ")}`}>
      {strokes.map((s, i) => (
        <kbd key={i} aria-hidden="true">
          {s}
        </kbd>
      ))}
    </span>
  );
}
