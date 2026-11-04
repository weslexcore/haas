import { useEffect, useState } from "react";
import { editedThumbnailUrl } from "../develop/edited-thumbs";
import { extension } from "../../core/library/formats";
import { fileKey } from "../../core/library/util";
import { displayedRecord } from "../../core/state/selectors";
import type { PhotoRecord } from "../../core/state/types";
import { useAppState } from "../hooks";
import { useRuntime } from "../runtime-context";
import { unsupportedMessage } from "../unsupported";
import { Placeholder } from "./PhotoMeta";
import styles from "./Thumb.module.css";

/**
 * Loads a thumbnail while mounted; cancels the decode if unmounted first
 * (e.g. scrolled away). A grouped RAW shows its camera JPEG.
 */
export function useThumbnail(photo: PhotoRecord | undefined): { url: string | null; failed: boolean } {
  const { services } = useRuntime();
  const shown = useAppState((s) => (photo ? displayedRecord(s, photo) : undefined));
  const [state, setState] = useState<{ key: string; url: string | null; failed: boolean }>({ key: "", url: null, failed: false });
  const key = shown ? `${shown.id}|${fileKey(shown)}` : "";

  useEffect(() => {
    if (!shown || shown.placeholderHue !== undefined) return;
    const controller = new AbortController();
    let live = true;
    services.previews
      .thumbnailUrl(shown, controller.signal)
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

/**
 * The thumbnail with the photo's develop edits applied. Waits until editing
 * pauses (a slider drag re-renders only once it settles) and keeps showing
 * the previous image meanwhile.
 */
function useEditedThumbnail(photo: PhotoRecord, baseUrl: string | null): string | null {
  const { services } = useRuntime();
  const [url, setUrl] = useState<string | null>(null);
  const recipeKey = photo.edit ? JSON.stringify(photo.edit) : "";
  const needsBase = photo.placeholderHue === undefined;
  useEffect(() => {
    if (!photo.edit || (needsBase && !baseUrl)) return setUrl(null);
    let live = true;
    const recipe = photo.edit;
    const timer = setTimeout(() => {
      void editedThumbnailUrl(services.previews, photo, recipe, baseUrl).then((u) => live && setUrl(u));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Keyed on the recipe's content and the base image, not the record object.
  }, [recipeKey, baseUrl, photo.id, needsBase, services]);
  return photo.edit ? url : null;
}

/** Decorative: always used inside a control that is already labelled with the file name. */
export function Thumb({ photo, className }: { photo: PhotoRecord; className?: string }) {
  const { url, failed } = useThumbnail(photo);
  const edited = useEditedThumbnail(photo, url);
  if (photo.placeholderHue !== undefined && !edited) return <Placeholder photo={photo} className={className} decorative />;
  if (edited) {
    return (
      <div className={`${styles.thumb} ${className ?? ""}`}>
        <img src={edited} alt="" draggable={false} decoding="async" />
      </div>
    );
  }
  return (
    <div className={`${styles.thumb} ${className ?? ""}`}>
      {url ? (
        <img src={url} alt="" draggable={false} decoding="async" />
      ) : failed ? (
        <span className={styles.unsupported} title={unsupportedMessage(photo)}>
          {extension(photo.id).toUpperCase()}
        </span>
      ) : null}
    </div>
  );
}
