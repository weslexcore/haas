import { useAppState } from "../hooks";
import { ActionButton } from "./ActionButton";
import styles from "./ExportProgress.module.css";

/**
 * Progress of the running export (develop.export) with a Cancel button.
 * Inline in the status bar; `floating` places it above the bottom bar on
 * small screens, which have no status bar. Renders nothing when idle.
 */
export function ExportProgress({ floating = false }: { floating?: boolean }) {
  const job = useAppState((s) => s.develop.exportJob);
  if (!job) return null;
  return (
    <span className={`${styles.progress} ${floating ? styles.floating : ""}`} role="status" aria-live="polite">
      <progress className={styles.bar} value={job.done} max={job.total} aria-label="Export progress" />
      <span className={styles.text}>
        Exporting {job.done}/{job.total}
        {job.failed > 0 && ` (${job.failed} failed)`}…
      </span>
      <ActionButton actionId="develop.export.cancel" className={styles.cancel}>
        Cancel
      </ActionButton>
    </span>
  );
}
