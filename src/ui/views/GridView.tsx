import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { selectVisibleIds } from "../../core/state/selectors";
import type { PhotoRecord } from "../../core/state/types";
import { useAppState } from "../hooks";
import { FilterBar } from "./FilterBar";
import { usePhotoInteractions } from "./photo-interactions";
import { FlagMark, LabelDot, Stars } from "./PhotoMeta";
import { Thumb } from "./Thumb";
import styles from "./GridView.module.css";

const PAD = 12;
const GAP = 8;
const MIN_CELL = 168;
const CELL_CHROME = 16 + 44; // padding + meta rows

/** Virtualized thumbnail grid: only rows near the viewport are rendered. */
export function GridView() {
  const visible = useAppState(selectVisibleIds);
  const byId = useAppState((s) => s.photos.byId);
  const { activeId, ids } = useAppState((s) => s.selection);
  const selected = new Set(ids);
  const { select, openMenu, dispatch } = usePhotoInteractions("grid.photo");
  const openLoupe = useCallback(() => void dispatch("view.set", { view: "loupe" }), [dispatch]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const inner = Math.max(0, width - PAD * 2);
  const cols = Math.max(1, Math.floor((inner + GAP) / (MIN_CELL + GAP)));
  const cellWidth = (inner - GAP * (cols - 1)) / cols;
  const rowHeight = Math.round(((cellWidth - 16) * 2) / 3 + CELL_CHROME + GAP);
  const rowCount = Math.ceil(visible.length / cols);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
    paddingStart: PAD,
    paddingEnd: PAD,
  });

  useEffect(() => virtualizer.measure(), [virtualizer, rowHeight]);

  useEffect(() => {
    const index = activeId ? visible.indexOf(activeId) : -1;
    if (index >= 0 && width > 0) virtualizer.scrollToIndex(Math.floor(index / cols), { align: "auto" });
  }, [activeId, cols, width, visible, virtualizer]);

  return (
    <div className={styles.layout}>
      <FilterBar />
      <div ref={scrollRef} className={styles.scroller}>
        {visible.length === 0 ? (
          <p className={styles.noMatches}>No photos match the filter.</p>
        ) : (
          <div
            role="list"
            aria-label="Photos"
            className={styles.canvas}
            style={{ height: virtualizer.getTotalSize() }}
          >
            {width > 0 &&
              virtualizer.getVirtualItems().map((row) => (
                <div
                  key={row.key}
                  className={styles.row}
                  style={{
                    transform: `translateY(${row.start}px)`,
                    height: rowHeight - GAP,
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  }}
                >
                  {visible.slice(row.index * cols, row.index * cols + cols).map((id, i) => (
                    <GridCell
                      key={id}
                      photo={byId[id]!}
                      position={row.index * cols + i + 1}
                      count={visible.length}
                      selected={selected.has(id)}
                      active={id === activeId}
                      onSelect={select}
                      onMenu={openMenu}
                      onOpen={openLoupe}
                    />
                  ))}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface CellProps {
  photo: PhotoRecord;
  position: number;
  count: number;
  selected: boolean;
  active: boolean;
  onSelect: (e: MouseEvent, id: string) => void;
  onMenu: (e: MouseEvent, id: string) => void;
  onOpen: () => void;
}

const GridCell = memo(function GridCell({ photo, position, count, selected, active, onSelect, onMenu, onOpen }: CellProps) {
  return (
    <div role="listitem" aria-setsize={count} aria-posinset={position}>
      <button
        type="button"
        data-photo-id={photo.id}
        className={`${styles.cell} ${selected ? styles.selected : ""} ${active ? styles.active : ""} ${photo.flag === "reject" ? styles.rejected : ""}`}
        aria-pressed={selected}
        aria-current={active ? "true" : undefined}
        aria-label={photo.fileName}
        onClick={(e) => onSelect(e, photo.id)}
        onDoubleClick={onOpen}
        onContextMenu={(e) => onMenu(e, photo.id)}
      >
        <span className={styles.index}>{position}</span>
        <Thumb photo={photo} className={styles.thumb} />
        <span className={styles.meta}>
          <Stars rating={photo.rating} />
          <span className={styles.marks}>
            <LabelDot label={photo.colorLabel} />
            <FlagMark flag={photo.flag} />
          </span>
        </span>
        <span className={styles.name}>{photo.fileName}</span>
      </button>
    </div>
  );
});
