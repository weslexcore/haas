import { useEffect, useRef, useState, type MouseEvent } from "react";
import { companionOf, displayedRecord, selectVisibleIds } from "../../core/state/selectors";
import type { PhotoRecord } from "../../core/state/types";
import { useAppState, useDispatch } from "../hooks";
import { useLongPress, type Point } from "../hooks/gestures";
import { useRuntime } from "../runtime-context";
import { unsupportedMessage } from "../unsupported";
import { FlagMark, LabelDot, Placeholder, Stars, formatCaptured, formatExposure } from "./PhotoMeta";
import { defaultRecipe } from "../../core/develop/recipe";
import { CropBar } from "../develop/CropBar";
import { CropOverlay } from "../develop/CropOverlay";
import { DevelopCanvas } from "../develop/DevelopCanvas";
import { MaskOverlay } from "../develop/MaskOverlay";
import styles from "./PhotoStage.module.css";

/**
 * Full-size image URL for a photo (a grouped RAW shows its camera JPEG), with
 * the neighbours preloaded for instant next/previous.
 */
function useImageUrl(photo: PhotoRecord | undefined): { url: string | null; error: boolean } {
  const { services, store } = useRuntime();
  const shown = useAppState((s) => (photo ? displayedRecord(s, photo) : undefined));
  const [state, setState] = useState<{ key: string; url: string | null; error: boolean }>({ key: "", url: null, error: false });
  const key = photo && shown ? `${photo.id}|${shown.id}|${shown.lastModified}` : "";

  useEffect(() => {
    if (!photo || !shown || shown.placeholderHue !== undefined) return;
    let live = true;
    services.previews
      .imageUrl(shown)
      .then((url) => live && setState({ key, url, error: !url }))
      .catch(() => live && setState({ key, url: null, error: true }));

    const state = store.getState();
    const order = selectVisibleIds(state);
    const i = order.indexOf(photo.id);
    for (const id of [order[i + 1], order[i - 1]]) {
      const neighbour = id ? state.photos.byId[id] : undefined;
      if (neighbour) {
        void services.previews.imageUrl(displayedRecord(state, neighbour)).then((url) => {
          if (url) new Image().src = url;
        }).catch(() => undefined);
      }
    }
    return () => {
      live = false;
    };
    // Keyed on the files (key), not the record, so rating edits don't reload the image.
  }, [key, services, store]);

  return state.key === key ? state : { url: null, error: false };
}

interface PhotoStageProps {
  zoomable?: boolean;
  dimmed?: boolean;
  badge?: string;
}

/** The active photo, large: fit or 100% zoom, info overlay, right-click (or long-press) menu. */
export function PhotoStage({ zoomable = false, dimmed = false, badge }: PhotoStageProps) {
  const runtime = useRuntime();
  const photo = useAppState((s) => (s.selection.activeId ? s.photos.byId[s.selection.activeId] : undefined));
  const zoom = useAppState((s) => (zoomable ? s.zoom : "fit"));
  const info = useAppState((s) => s.infoOverlay);
  const cropTool = useAppState((s) => zoomable && s.develop.cropTool);
  const levelTool = useAppState((s) => s.develop.levelTool);
  const maskTool = useAppState((s) => s.develop.maskTool);
  const dispatch = useDispatch();
  const { url, error } = useImageUrl(photo);
  const stageRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const openMenu = (at: Point) => void dispatch("app.contextMenu.open", { menuId: "loupe.photo", x: at.x, y: at.y });
  const press = useLongPress(openMenu);
  const onContextMenu = (e: MouseEvent) => {
    press.onContextMenu(e);
    if (e.defaultPrevented) return;
    e.preventDefault();
    openMenu({ x: e.clientX, y: e.clientY });
  };

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

  // Edited photos render through the develop pipeline so Loupe shows the edits (and the selected mask's handles).
  if (photo.edit || (zoomable && maskTool.drawing)) {
    const recipe = photo.edit ?? defaultRecipe();
    const selectedMask = zoomable ? (recipe.masks.find((m) => m.id === maskTool.selectedId) ?? null) : null;
    const masking = zoomable && (selectedMask !== null || maskTool.drawing !== null);
    return (
      <div className={styles.editedStage} data-zoom={zoom} {...press} onContextMenu={onContextMenu}>
        <DevelopCanvas
          key={photo.id}
          photo={photo}
          scale={zoom === "actual" ? "actual" : "fit"}
          showMask={masking && maskTool.overlay && selectedMask ? selectedMask.id : undefined}
          overlay={masking ? (display) => <MaskOverlay photo={photo} mask={selectedMask} crop={recipe.crop} display={display} drawing={maskTool.drawing} /> : undefined}
        />
        {info && <InfoOverlay photo={photo} />}
      </div>
    );
  }

  const dpr = window.devicePixelRatio || 1;
  const unsupported = error || failed === photo.id;

  return (
    <div
      ref={stageRef}
      className={`${styles.stage} ${zoom === "actual" ? styles.actual : ""}`}
      {...press}
      onContextMenu={onContextMenu}
      data-photo-id={photo.id}
    >
      {photo.placeholderHue !== undefined ? (
        <Placeholder photo={photo} className={`${styles.placeholder} ${dimmed ? styles.dimmed : ""}`} />
      ) : unsupported ? (
        <p className={styles.message}>{unsupportedMessage(photo)}</p>
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
  const companion = useAppState((s) => companionOf(s, photo.id));
  return (
    <div className={styles.info} aria-label="Photo information">
      <strong>
        {photo.fileName}
        {companion && ` +${companion.slice(companion.lastIndexOf(".") + 1).toUpperCase()}`}
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
