import type { ColorLabel, Flag, SortKey } from "../../core/state/types";
import { isFilterActive, selectVisibleIds } from "../../core/state/selectors";
import { useAppState, useDispatch } from "../hooks";
import styles from "./FilterBar.module.css";

const FLAG_OPTIONS: Array<{ flag: Flag; label: string; mark: string }> = [
  { flag: "pick", label: "Picked", mark: "⚑" },
  { flag: "none", label: "Unflagged", mark: "○" },
  { flag: "reject", label: "Rejected", mark: "✕" },
];
const LABELS: Array<Exclude<ColorLabel, "none">> = ["red", "yellow", "green", "blue", "purple"];
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "capturedAt", label: "Capture time" },
  { key: "fileName", label: "File name" },
  { key: "rating", label: "Rating" },
  { key: "size", label: "File size" },
];

const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

/** Library filter and sort controls. Every control dispatches an action. */
export function FilterBar() {
  const filter = useAppState((s) => s.library.filter);
  const sort = useAppState((s) => s.library.sort);
  const shown = useAppState((s) => selectVisibleIds(s).length);
  const total = useAppState((s) => s.photos.order.length);
  const dispatch = useDispatch();
  const setFilter = (params: object) => void dispatch("library.filter.set", params);

  return (
    <div className={styles.bar} role="toolbar" aria-label="Filter and sort">
      <div className={styles.group} role="group" aria-label="Minimum rating">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={styles.toggle}
            aria-pressed={filter.minRating === n}
            aria-label={n === 0 ? "Any rating" : `${n} stars and up`}
            onClick={() => setFilter({ minRating: n })}
          >
            {n === 0 ? "Any" : `${n}★+`}
          </button>
        ))}
      </div>

      <div className={styles.group} role="group" aria-label="Flags">
        {FLAG_OPTIONS.map(({ flag, label, mark }) => (
          <button
            key={flag}
            type="button"
            className={styles.toggle}
            aria-pressed={filter.flags.includes(flag)}
            aria-label={label}
            title={label}
            onClick={() => setFilter({ flags: toggle(filter.flags, flag) })}
          >
            {mark}
          </button>
        ))}
      </div>

      <div className={styles.group} role="group" aria-label="Colour labels">
        {LABELS.map((label) => (
          <button
            key={label}
            type="button"
            className={`${styles.toggle} ${styles.swatchButton}`}
            aria-pressed={filter.colorLabels.includes(label)}
            aria-label={`${label} label`}
            title={label}
            onClick={() => setFilter({ colorLabels: toggle(filter.colorLabels, label) })}
          >
            <span className={styles.swatch} style={{ background: `var(--label-${label})` }} />
          </button>
        ))}
      </div>

      <input
        type="search"
        className={styles.search}
        placeholder="File name"
        aria-label="Filter by file name"
        value={filter.text}
        onChange={(e) => setFilter({ text: e.target.value })}
      />

      <span className={styles.spacer} />

      <label className={styles.sort}>
        <span className="visually-hidden">Sort by</span>
        <select
          value={sort.key}
          onChange={(e) => void dispatch("library.sort.set", { key: e.target.value, direction: sort.direction })}
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={styles.toggle}
        aria-label={sort.direction === "asc" ? "Ascending; switch to descending" : "Descending; switch to ascending"}
        onClick={() => void dispatch("library.sort.set", { key: sort.key, direction: sort.direction === "asc" ? "desc" : "asc" })}
      >
        {sort.direction === "asc" ? "↑" : "↓"}
      </button>

      <span className={styles.count} aria-live="polite">
        {shown === total ? `${total} photos` : `${shown} of ${total}`}
      </span>
      {isFilterActive(filter) && (
        <button type="button" className={styles.clear} onClick={() => void dispatch("library.filter.clear")}>
          Clear
        </button>
      )}
    </div>
  );
}
