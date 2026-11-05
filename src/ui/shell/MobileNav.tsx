import { useState } from "react";
import type { ViewMode } from "../../core/state/types";
import { isFilterActive } from "../../core/state/selectors";
import { useAppState } from "../hooks";
import { GridSizeSlider } from "../views/GridSizeSlider";
import { FilterBar } from "../views/FilterBar";
import { ActionButton } from "./ActionButton";
import { Icon, type IconName } from "./Icon";
import { Modal } from "./Modal";
import styles from "./MobileNav.module.css";

const VIEWS: Array<{ view: ViewMode; label: string; icon: IconName }> = [
  { view: "grid", label: "Grid", icon: "grid" },
  { view: "loupe", label: "Loupe", icon: "loupe" },
  { view: "develop", label: "Develop", icon: "develop" },
];

/**
 * The bar along the bottom edge on small screens: the three views, the
 * filter sheet (the filter bar has no room above the photos there) and the
 * photo menu (what a right-click or long press opens).
 */
export function MobileNav() {
  const current = useAppState((s) => s.view);
  const hasPhotos = useAppState((s) => s.photos.order.length > 0);
  const filtering = useAppState((s) => isFilterActive(s.library.filter));
  const [filterOpen, setFilterOpen] = useState(false);

  return (
    <>
      <nav className={styles.bar} aria-label="Views and tools">
        {VIEWS.map(({ view, label, icon }) => (
          <ActionButton key={view} actionId="view.set" params={{ view }} className={styles.tab} aria-pressed={current === view}>
            <Icon name={icon} size={20} />
            <span className={styles.label}>{label}</span>
          </ActionButton>
        ))}
        <button
          type="button"
          className={styles.tab}
          aria-label={filtering ? "Filter and sort (a filter is on)" : "Filter and sort"}
          aria-expanded={filterOpen}
          disabled={!hasPhotos}
          onClick={() => setFilterOpen(true)}
        >
          <span className={styles.iconWrap}>
            <Icon name="filter" size={20} />
            {filtering && <span className={styles.dot} aria-hidden="true" />}
          </span>
          <span className={styles.label}>Filter</span>
        </button>
        <ActionButton actionId="app.contextMenu.open" params={{}} label="Photo menu" className={styles.tab} disabled={!hasPhotos}>
          <Icon name="photo" size={20} />
          <span className={styles.label}>Photo</span>
        </ActionButton>
      </nav>
      {filterOpen && (
        <Modal label="Filter and sort" placement="bottom" onEscape={() => setFilterOpen(false)} onBackdropClick={() => setFilterOpen(false)} className={styles.sheet}>
          <div className={styles.sheetHeader}>
            <span className={styles.sheetTitle}>Filter & Sort</span>
            <button type="button" className={styles.done} data-autofocus onClick={() => setFilterOpen(false)}>
              Done
            </button>
          </div>
          <div className={styles.sheetBody}>
            <FilterBar layout="stack">{current === "grid" && <GridSizeSlider caption />}</FilterBar>
          </div>
        </Modal>
      )}
    </>
  );
}
