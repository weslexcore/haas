import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { companionOf, selectVisibleIds } from "../../core/state/selectors";
import type { PhotoRecord } from "../../core/state/types";
import { useAppState } from "../hooks";
import { useLongPress, type Point } from "../hooks/gestures";
import { useMobileLayout } from "../hooks/media";
import { pointerKindOf } from "../input-store";
import { FilterBar } from "./FilterBar";
import { GridSizeSlider } from "./GridSizeSlider";
import { usePhotoInteractions } from "./photo-interactions";
import { FlagMark, LabelDot, Stars } from "./PhotoMeta";
import { Thumb } from "./Thumb";
import styles from "./GridView.module.css";

const PAD = 12;
const GAP = 8;
const CELL_CHROME = 16 + 44; // padding + meta rows

/** Virtualized thumbnail grid: only rows near the viewport are rendered. */
export function GridView() {
  const visible = useAppState(selectVisibleIds);
  const byId = useAppState((s) => s.photos.byId);
  const { activeId, ids } = useAppState((s) => s.selection);
  const selected = new Set(ids);
  const cellTarget = useAppState((s) => s.layout.gridCellWidth);
  const mobile = useMobileLayout();
  const { select, openMenu, openMenuAt, dispatch } = usePhotoInteractions("grid.photo");
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
  const cols = Math.max(1, Math.floor((inner + GAP) / (cellTarget + GAP)));
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
      {/* On small screens the filter lives in a sheet behind the bottom bar's Filter button. */}
      {!mobile && (
        <FilterBar>
          <GridSizeSlider />
        </FilterBar>
      )}
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
                      only={id === activeId && ids.length === 1}
                      onSelect={select}
                      onMenu={openMenu}
                      onMenuAt={openMenuAt}
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
  /** The only selected photo: a second tap on it opens Loupe (touch has no double-click). */
  only: boolean;
  onSelect: (e: MouseEvent, id: string) => void;
  onMenu: (e: MouseEvent, id: string) => void;
  onMenuAt: (id: string, at: Point) => void;
  onOpen: () => void;
}

const GridCell = memo(function GridCell({ photo, position, count, selected, active, only, onSelect, onMenu, onMenuAt, onOpen }: CellProps) {
  const paired = useAppState((s) => !!companionOf(s, photo.id));
  const press = useLongPress((at) => onMenuAt(photo.id, at));
  return (
    <div role="listitem" aria-setsize={count} aria-posinset={position}>
      <button
        type="button"
        data-photo-id={photo.id}
        className={`${styles.cell} ${selected ? styles.selected : ""} ${active ? styles.active : ""} ${photo.flag === "reject" ? styles.rejected : ""}`}
        aria-pressed={selected}
        aria-current={active ? "true" : undefined}
        aria-label={photo.fileName}
        {...press}
        onClick={(e) => (only && pointerKindOf(e) === "touch" ? onOpen() : onSelect(e, photo.id))}
        onDoubleClick={onOpen}
        onContextMenu={(e) => {
          press.onContextMenu(e);
          onMenu(e, photo.id);
        }}
      >
        <span className={styles.index}>{position}</span>
        {paired && (
          <span className={styles.pair} title="A RAW+JPEG pair, shown as one photo">
            RAW+JPG
          </span>
        )}
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
