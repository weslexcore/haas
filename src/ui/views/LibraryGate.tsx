import type { ReactNode } from "react";
import { useAppState, useShortcut } from "../hooks";
import { ActionButton } from "../shell/ActionButton";
import { Kbd } from "../shell/Kbd";
import styles from "./LibraryGate.module.css";

/** Shows the empty, loading, reconnect and error states; renders the view once photos exist. */
export function LibraryGate({ children }: { children: ReactNode }) {
  const status = useAppState((s) => s.library.status);
  const count = useAppState((s) => s.photos.order.length);
  const removed = useAppState((s) => s.library.removedCount);
  const openShortcut = useShortcut("library.folder.open");

  if (count > 0) return <>{children}</>;

  const openButtons = (
    <div className={styles.actions}>
      <ActionButton actionId="library.folder.open" className={styles.primary}>
        Open Folder… {openShortcut && <Kbd strokes={openShortcut.strokes} />}
      </ActionButton>
      <ActionButton actionId="library.sample.load" className={styles.secondary}>
        Open Sample Library
      </ActionButton>
    </div>
  );

  let body: ReactNode;
  switch (status.kind) {
    case "loading":
      body = <p role="status">{status.message}</p>;
      break;
    case "needsPermission":
      body = (
        <>
          <h2 className={styles.title}>Reconnect to “{status.folder.name}”</h2>
          <p>The browser needs your permission to read this folder again.</p>
          <div className={styles.actions}>
            <ActionButton actionId="library.folder.reconnect" className={styles.primary}>
              Reconnect
            </ActionButton>
            <ActionButton actionId="library.folder.open" className={styles.secondary}>
              Open a Different Folder…
            </ActionButton>
          </div>
        </>
      );
      break;
    case "error":
      body = (
        <>
          <p className={styles.error} role="alert">
            {status.message}
          </p>
          {removed > 0 && (
            <ActionButton actionId="library.removed.restore" className={styles.secondary}>
              Restore {removed} Removed Photo{removed === 1 ? "" : "s"}
            </ActionButton>
          )}
          {openButtons}
        </>
      );
      break;
    default:
      body = (
        <>
          <h2 className={styles.title}>Open a folder of photos</h2>
          <p>
            JPEG, PNG, WebP, AVIF and HEIC (where the browser supports it), including subfolders. Originals are never
            changed; ratings and labels are saved in the app and, where allowed, in XMP sidecars.
          </p>
          {openButtons}
        </>
      );
  }
  return <div className={styles.gate}>{body}</div>;
}
