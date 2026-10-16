import { useEffect, useState } from "react";
import { extension } from "../../core/library/formats";
import { fileKey } from "../../core/library/util";
import type { PhotoRecord } from "../../core/state/types";
import { useRuntime } from "../runtime-context";
import { Placeholder } from "./PhotoMeta";
import styles from "./Thumb.module.css";

/** Loads a thumbnail while mounted; cancels the decode if unmounted first (e.g. scrolled away). */
export function useThumbnail(photo: PhotoRecord | undefined): { url: string | null; failed: boolean } {
  const { services } = useRuntime();
  const [state, setState] = useState<{ key: string; url: string | null; failed: boolean }>({ key: "", url: null, failed: false });
  const key = photo ? `${photo.id}|${fileKey(photo)}` : "";

  useEffect(() => {
    if (!photo || photo.placeholderHue !== undefined) return;
    const controller = new AbortController();
    let live = true;
    services.previews
      .thumbnailUrl(photo, controller.signal)
      .then((url) => live && setState({ key, url, failed: url === null }))
      .catch(() => live && !controller.signal.aborted && setState({ key, url: null, failed: true }));
    return () => {
      live = false;
      controller.abort();
    };
    // Keyed on the file (key), not the photo object, so rating/flag edits don't reload the thumbnail.
  }, [key, services]);

  return state.key === key ? state : { url: null, failed: false };
}

/** Decorative: always used inside a control that is already labelled with the file name. */
export function Thumb({ photo, className }: { photo: PhotoRecord; className?: string }) {
  const { url, failed } = useThumbnail(photo);
  if (photo.placeholderHue !== undefined) return <Placeholder photo={photo} className={className} decorative />;
  return (
    <div className={`${styles.thumb} ${className ?? ""}`}>
      {url ? (
        <img src={url} alt="" draggable={false} decoding="async" />
      ) : failed ? (
        <span className={styles.unsupported} title="No preview available in this browser">
          {extension(photo.id).toUpperCase()}
        </span>
      ) : null}
    </div>
  );
}
