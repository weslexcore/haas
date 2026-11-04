import { useEffect, useRef, useState, type MouseEvent } from "react";
import { selectVisibleIds } from "../../core/state/selectors";
import type { PhotoRecord } from "../../core/state/types";
import { useAppState, useDispatch } from "../hooks";
import { useRuntime } from "../runtime-context";
import { FlagMark, LabelDot, Placeholder, Stars, formatCaptured, formatExposure } from "./PhotoMeta";
import { defaultRecipe } from "../../core/develop/recipe";
import { CropBar } from "../develop/CropBar";
import { CropOverlay } from "../develop/CropOverlay";
import { DevelopCanvas } from "../develop/DevelopCanvas";
import styles from "./PhotoStage.module.css";

/** Full-size image URL for a photo, with the neighbours preloaded for instant next/previous. */
function useImageUrl(photo: PhotoRecord | undefined): { url: string | null; error: boolean } {
  const { services, store } = useRuntime();
  const [state, setState] = useState<{ id: string; url: string | null; error: boolean }>({ id: "", url: null, error: false });

  useEffect(() => {
    if (!photo || photo.placeholderHue !== undefined) return;
    let live = true;
    services.previews
      .imageUrl(photo)
      .then((url) => live && setState({ id: photo.id, url, error: !url }))
      .catch(() => live && setState({ id: photo.id, url: null, error: true }));

    const order = selectVisibleIds(store.getState());
    const i = order.indexOf(photo.id);
    for (const id of [order[i + 1], order[i - 1]]) {
      const neighbour = id ? store.getState().photos.byId[id] : undefined;
      if (neighbour) {
        void services.previews.imageUrl(neighbour).then((url) => {
          if (url) new Image().src = url;
        }).catch(() => undefined);
      }
    }
    return () => {
      live = false;
    };
    // Keyed on the file, not the record, so rating edits don't reload the image.
  }, [photo?.id, photo?.lastModified, services, store]);

  return photo && state.id === photo.id ? state : { url: null, error: false };
}

interface PhotoStageProps {
  zoomable?: boolean;
  dimmed?: boolean;
  badge?: string;
}

/** The active photo, large: fit or 100% zoom, info overlay, right-click menu. */
export function PhotoStage({ zoomable = false, dimmed = false, badge }: PhotoStageProps) {
  const runtime = useRuntime();
  const photo = useAppState((s) => (s.selection.activeId ? s.photos.byId[s.selection.activeId] : undefined));
  const zoom = useAppState((s) => (zoomable ? s.zoom : "fit"));
  const info = useAppState((s) => s.infoOverlay);
  const cropTool = useAppState((s) => zoomable && s.develop.cropTool);
  const levelTool = useAppState((s) => s.develop.levelTool);
  const dispatch = useDispatch();
  const { url, error } = useImageUrl(photo);
  const stageRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // Centre the image when switching to 100%.
  useEffect(() => {
    const el = stageRef.current;
    if (el && zoom === "actual") {
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
      el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
    }
  }, [zoom, url]);

  if (!photo) return <div className={styles.stage} />;

  // Cropping in Loupe: the whole straightened frame with the crop overlay, as in Develop.
  if (cropTool) {
    const crop = (photo.edit ?? defaultRecipe()).crop;
    return (
      <div className={styles.editedStage}>
        <DevelopCanvas
          key={photo.id}
          photo={photo}
          ignoreCrop
          overlay={(display) => <CropOverlay crop={crop} display={display} levelTool={levelTool} />}
        />
        <CropBar photo={photo} />
      </div>
    );
  }

  // Edited photos render through the develop pipeline so Loupe shows the edits.
  if (photo.edit) {
    return (
      <div className={styles.editedStage} data-zoom={zoom}>
        <DevelopCanvas
          key={photo.id}
          photo={photo}
          scale={zoom === "actual" ? "actual" : "fit"}
          onContextMenu={(e) => {
            e.preventDefault();
            void dispatch("app.contextMenu.open", { menuId: "loupe.photo", x: e.clientX, y: e.clientY });
          }}
        />
        {info && <InfoOverlay photo={photo} />}
      </div>
    );
  }

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    void dispatch("app.contextMenu.open", { menuId: "loupe.photo", x: e.clientX, y: e.clientY });
  };
  const dpr = window.devicePixelRatio || 1;
  const unsupported = error || failed === photo.id;

  return (
    <div
      ref={stageRef}
      className={`${styles.stage} ${zoom === "actual" ? styles.actual : ""}`}
      onContextMenu={onContextMenu}
      data-photo-id={photo.id}
    >
      {photo.placeholderHue !== undefined ? (
        <Placeholder photo={photo} className={`${styles.placeholder} ${dimmed ? styles.dimmed : ""}`} />
      ) : unsupported ? (
        <p className={styles.message}>This browser can't display {photo.fileName}.</p>
      ) : url ? (
        <img
          key={url}
          src={url}
          alt={photo.fileName}
          className={`${styles.image} ${dimmed ? styles.dimmed : ""}`}
          style={zoom === "actual" && photo.width ? { width: photo.width / dpr } : undefined}
          draggable={false}
          onError={() => setFailed(photo.id)}
          onClick={zoomable ? () => void runtime.dispatch("view.zoom.toggle", undefined, { source: "ui" }) : undefined}
        />
      ) : null}
      {badge && <span className={styles.badge}>{badge}</span>}
      {info && <InfoOverlay photo={photo} />}
    </div>
  );
}

export function InfoOverlay({ photo }: { photo: PhotoRecord }) {
  const camera = [photo.exif?.make, photo.exif?.model].filter(Boolean).join(" ");
  return (
    <div className={styles.info} aria-label="Photo information">
      <strong>
        {photo.fileName}
        {photo.companion && ` +${photo.companion.slice(photo.companion.lastIndexOf(".") + 1).toUpperCase()}`}
      </strong>
      <span>{formatCaptured(photo.capturedAt)}</span>
      {photo.width && photo.height && (
        <span>
          {photo.width} × {photo.height}
        </span>
      )}
      {camera && <span>{camera}</span>}
      {photo.exif?.lens && <span>{photo.exif.lens}</span>}
      {formatExposure(photo.exif).length > 0 && <span>{formatExposure(photo.exif).join("  ")}</span>}
      <span className={styles.infoMarks}>
        <Stars rating={photo.rating} />
        <LabelDot label={photo.colorLabel} />
        <FlagMark flag={photo.flag} />
      </span>
    </div>
  );
}
