import { useStore } from "zustand";
import { dismissToast, toastStore } from "../toasts";
import styles from "./Toasts.module.css";

export function Toasts() {
  const toasts = useStore(toastStore, (s) => s.toasts);
  return (
    <div className={styles.stack} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${t.tone === "error" ? styles.error : ""}`}>
          <span className={styles.message}>{t.message}</span>
          <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
