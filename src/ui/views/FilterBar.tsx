import type { ReactNode } from "react";
import type { ColorLabel, Flag, SortKey } from "../../core/state/types";
import { isFilterActive, selectLibraryIds, selectPairs, selectVisibleIds } from "../../core/state/selectors";
import { useAppState, useDispatch, useShortcut } from "../hooks";
import { ActionButton } from "../shell/ActionButton";
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

interface FilterBarProps {
  /** "bar": one wrapping row above the photos (default). "stack": a labelled column, for the filter sheet on small screens. */
  layout?: "bar" | "stack";
  /** Go at the far right (view-specific controls). */
  children?: ReactNode;
}

/** Library filter and sort controls. Every control dispatches an action. */
export function FilterBar({ layout = "bar", children }: FilterBarProps) {
  const filter = useAppState((s) => s.library.filter);
  const sort = useAppState((s) => s.library.sort);
  const shown = useAppState((s) => selectVisibleIds(s).length);
  const total = useAppState((s) => selectLibraryIds(s).length);
  const removed = useAppState((s) => s.library.removedCount);
  const dispatch = useDispatch();
  const setFilter = (params: object) => void dispatch("library.filter.set", params);
  const stacked = layout === "stack";

  const Field = stacked ? CaptionedField : PlainField;

  return (
    <div className={`${styles.bar} ${stacked ? styles.stack : ""}`} role="toolbar" aria-label="Filter and sort" aria-orientation={stacked ? "vertical" : "horizontal"}>
      <Field caption="Rating">
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
      </Field>

      <Field caption="Flags">
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
              {stacked && <span className={styles.toggleText}>{label}</span>}
            </button>
          ))}
        </div>
      </Field>

      <Field caption="Colour labels">
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
      </Field>

      <Field caption="File name">
        <input
          type="search"
          className={styles.search}
          placeholder="File name"
          aria-label="Filter by file name"
          value={filter.text}
          onChange={(e) => setFilter({ text: e.target.value })}
        />
      </Field>

      <PairsToggle stacked={stacked} />

      <span className={styles.spacer} />

      <Field caption="Sort">
        <div className={styles.sortRow}>
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
            {stacked && <span className={styles.toggleText}>{sort.direction === "asc" ? "Ascending" : "Descending"}</span>}
          </button>
        </div>
      </Field>

      <div className={styles.summary}>
        <span className={styles.count} aria-live="polite">
          {shown === total ? `${total} photos` : `${shown} of ${total}`}
        </span>
        {isFilterActive(filter) && (
          <button type="button" className={styles.clear} onClick={() => void dispatch("library.filter.clear")}>
            Clear
          </button>
        )}
      </div>
      {removed > 0 && <RemovedPhotos count={removed} />}
      {children}
    </div>
  );
}

interface FieldProps {
  caption: string;
  children: ReactNode;
}

/** In the sheet each group gets a caption; in the bar the groups are self-explanatory. */
const CaptionedField = ({ caption, children }: FieldProps) => (
  <div className={styles.field}>
    <span className={styles.caption}>{caption}</span>
    {children}
  </div>
);
const PlainField = ({ children }: FieldProps) => <>{children}</>;

/** Shown when the folder has RAW+JPEG pairs: one photo per pair (pressed), or the RAW and the JPEG separately. */
function PairsToggle({ stacked }: { stacked: boolean }) {
  const pairs = useAppState((s) => selectPairs(s).jpegByRaw.size);
  const grouped = useAppState((s) => s.library.groupRawJpeg);
  const shortcut = useShortcut("library.pairs.toggle");
  const dispatch = useDispatch();
  if (!pairs) return null;
  const label = grouped ? "RAW+JPEG pairs are grouped as one photo; click to list them separately" : "RAW and JPEG files are listed separately; click to group each pair as one photo";
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-pressed={grouped}
      aria-label="Group RAW+JPEG pairs"
      title={shortcut ? `${label} (${shortcut.strokes.join(" ")})` : label}
      onClick={() => void dispatch("library.pairs.toggle")}
    >
      RAW+JPG
      {stacked && <span className={styles.toggleText}>{grouped ? "grouped as one photo" : "listed separately"}</span>}
    </button>
  );
}

/** Photos moved to _Rejected: restore them, or delete them for good after confirming. */
function RemovedPhotos({ count }: { count: number }) {
  const dispatch = useDispatch();
  const photos = count === 1 ? "1 photo" : `${count} photos`;
  return (
    <span className={styles.removed} role="group" aria-label="Removed photos">
      <span title="Moved to the _Rejected folder inside this folder">{photos} in _Rejected</span>
      <ActionButton actionId="library.removed.restore" className={styles.clear} label="Restore removed photos">
        Restore
      </ActionButton>
      <button
        type="button"
        className={`${styles.clear} ${styles.danger}`}
        onClick={() => {
          if (confirm(`Permanently delete ${photos} in the _Rejected folder? This can't be undone (it also clears undo history), and they won't go to the system Trash.`)) {
            void dispatch("library.removed.empty", { confirm: true });
          }
        }}
      >
        Delete…
      </button>
    </span>
  );
}
