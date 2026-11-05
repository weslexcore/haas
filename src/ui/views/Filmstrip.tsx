import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useRef, type MouseEvent } from "react";
import { LAYOUT_LIMITS } from "../../core/state/layout";
import { selectVisibleIds } from "../../core/state/selectors";
import type { PhotoRecord } from "../../core/state/types";
import { useAppState, useDispatch, useShortcut } from "../hooks";
import { useLongPress, type Point } from "../hooks/gestures";
import { ResizeHandle } from "../layout/ResizeHandle";
import { Icon } from "../shell/Icon";
import { usePhotoInteractions } from "./photo-interactions";
import { FlagMark, LabelDot } from "./PhotoMeta";
import { Thumb } from "./Thumb";
import styles from "./Filmstrip.module.css";

/** Item width for the default strip height; items keep this proportion as the strip is resized. */
const ITEM_ASPECT = 112 / LAYOUT_LIMITS.filmstripHeight.default;

/** Horizontal, virtualized strip of the visible photos (Loupe and Develop). Drag its top edge to resize it. */
export function Filmstrip() {
  const visible = useAppState(selectVisibleIds);
  const byId = useAppState((s) => s.photos.byId);
  const { activeId, ids } = useAppState((s) => s.selection);
  const height = useAppState((s) => s.layout.filmstripHeight);
  const dispatch = useDispatch();
  const selected = new Set(ids);
  const { select, openMenu, openMenuAt } = usePhotoInteractions("grid.photo");
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemWidth = Math.round(height * ITEM_ASPECT);

  const virtualizer = useVirtualizer({
    horizontal: true,
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => itemWidth,
    overscan: 6,
  });

  // Item widths follow the strip height; the virtualizer only re-reads estimateSize after measure().
  useEffect(() => virtualizer.measure(), [itemWidth, virtualizer]);

  useEffect(() => {
    const index = activeId ? visible.indexOf(activeId) : -1;
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "center" });
  }, [activeId, visible, virtualizer, itemWidth]);

  return (
    <>
      <ResizeHandle
        orientation="horizontal"
        label="Filmstrip height"
        value={height}
        min={LAYOUT_LIMITS.filmstripHeight.min}
        max={LAYOUT_LIMITS.filmstripHeight.max}
        grow={-1}
        onResize={(h) => void dispatch("view.filmstrip.resize", { height: h })}
        onReset={() => void dispatch("view.filmstrip.resize")}
      />
      <div className={styles.wrap} style={{ height }}>
        <div ref={scrollRef} className={styles.strip} role="list" aria-label="Filmstrip">
          <div className={styles.canvas} style={{ width: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const id = visible[item.index]!;
              return (
                <FilmstripItem
                  key={id}
                  photo={byId[id]!}
                  start={item.start}
                  width={itemWidth}
                  selected={selected.has(id)}
                  active={id === activeId}
                  onSelect={select}
                  onMenu={openMenu}
                  onMenuAt={openMenuAt}
                />
              );
            })}
          </div>
        </div>
        <FilmstripToggle hidden={false} className={styles.hide} />
      </div>
    </>
  );
}

/** The slim bar left along the bottom when the filmstrip is hidden; its button brings the strip back. */
export function FilmstripCollapsed() {
  return (
    <div className={styles.collapsed}>
      <FilmstripToggle hidden />
    </div>
  );
}

function FilmstripToggle({ hidden, className }: { hidden: boolean; className?: string }) {
  const dispatch = useDispatch();
  const shortcut = useShortcut("view.filmstrip.toggle");
  const label = hidden ? "Show filmstrip" : "Hide filmstrip";
  return (
    <button
      type="button"
      className={`${styles.toggle} ${className ?? ""}`}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut.strokes.join(" ")})` : label}
      onClick={() => void dispatch("view.filmstrip.toggle")}
    >
      <Icon name={hidden ? "chevronUp" : "chevronDown"} size={14} />
    </button>
  );
}

interface ItemProps {
  photo: PhotoRecord;
  start: number;
  width: number;
  selected: boolean;
  active: boolean;
  onSelect: (e: MouseEvent, id: string) => void;
  onMenu: (e: MouseEvent, id: string) => void;
  onMenuAt: (id: string, at: Point) => void;
}

const FilmstripItem = memo(function FilmstripItem({ photo, start, width, selected, active, onSelect, onMenu, onMenuAt }: ItemProps) {
  const press = useLongPress((at) => onMenuAt(photo.id, at));
  return (
    <div role="listitem" className={styles.item} style={{ transform: `translateX(${start}px)`, width }}>
      <button
        type="button"
        data-photo-id={photo.id}
        className={`${styles.button} ${selected ? styles.selected : ""} ${active ? styles.active : ""}`}
        aria-label={photo.fileName}
        aria-pressed={selected}
        aria-current={active ? "true" : undefined}
        {...press}
        onClick={(e) => onSelect(e, photo.id)}
        onContextMenu={(e) => {
          press.onContextMenu(e);
          onMenu(e, photo.id);
        }}
      >
        <Thumb photo={photo} className={`${styles.thumb} ${photo.flag === "reject" ? styles.rejected : ""}`} />
        <span className={styles.marks}>
          {photo.rating > 0 && <span className={styles.rating}>{photo.rating}★</span>}
          <LabelDot label={photo.colorLabel} />
          <FlagMark flag={photo.flag} />
        </span>
      </button>
    </div>
  );
});
