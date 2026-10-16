import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useRef, type MouseEvent } from "react";
import { selectVisibleIds } from "../../core/state/selectors";
import type { PhotoRecord } from "../../core/state/types";
import { useAppState } from "../hooks";
import { usePhotoInteractions } from "./photo-interactions";
import { FlagMark, LabelDot } from "./PhotoMeta";
import { Thumb } from "./Thumb";
import styles from "./Filmstrip.module.css";

const ITEM_WIDTH = 112;

/** Horizontal, virtualized strip of the visible photos (Loupe and Develop). */
export function Filmstrip() {
  const visible = useAppState(selectVisibleIds);
  const byId = useAppState((s) => s.photos.byId);
  const { activeId, ids } = useAppState((s) => s.selection);
  const selected = new Set(ids);
  const { select, openMenu } = usePhotoInteractions("grid.photo");
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    horizontal: true,
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ITEM_WIDTH,
    overscan: 6,
  });

  useEffect(() => {
    const index = activeId ? visible.indexOf(activeId) : -1;
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "center" });
  }, [activeId, visible, virtualizer]);

  return (
    <div ref={scrollRef} className={styles.strip} role="list" aria-label="Filmstrip">
      <div className={styles.canvas} style={{ width: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const id = visible[item.index]!;
          return (
            <FilmstripItem
              key={id}
              photo={byId[id]!}
              start={item.start}
              selected={selected.has(id)}
              active={id === activeId}
              onSelect={select}
              onMenu={openMenu}
            />
          );
        })}
      </div>
    </div>
  );
}

interface ItemProps {
  photo: PhotoRecord;
  start: number;
  selected: boolean;
  active: boolean;
  onSelect: (e: MouseEvent, id: string) => void;
  onMenu: (e: MouseEvent, id: string) => void;
}

const FilmstripItem = memo(function FilmstripItem({ photo, start, selected, active, onSelect, onMenu }: ItemProps) {
  return (
    <div role="listitem" className={styles.item} style={{ transform: `translateX(${start}px)`, width: ITEM_WIDTH }}>
      <button
        type="button"
        data-photo-id={photo.id}
        className={`${styles.button} ${selected ? styles.selected : ""} ${active ? styles.active : ""}`}
        aria-label={photo.fileName}
        aria-pressed={selected}
        aria-current={active ? "true" : undefined}
        onClick={(e) => onSelect(e, photo.id)}
        onContextMenu={(e) => onMenu(e, photo.id)}
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
