import { LAYOUT_LIMITS } from "../../core/state/layout";
import { useAppState, useDispatch, useShortcut } from "../hooks";
import { Icon } from "../shell/Icon";
import styles from "./GridSizeSlider.module.css";

/** Thumbnail size: a slider at the right end of the filter bar (or in the filter sheet). Double-click restores the default. */
export function GridSizeSlider({ caption = false }: { caption?: boolean }) {
  const width = useAppState((s) => s.layout.gridCellWidth);
  const dispatch = useDispatch();
  const larger = useShortcut("view.grid.size.step", { direction: "larger" });
  const smaller = useShortcut("view.grid.size.step", { direction: "smaller" });
  const { min, max, step } = LAYOUT_LIMITS.gridCellWidth;
  const keys = larger && smaller ? ` (${smaller.strokes.join(" ")} / ${larger.strokes.join(" ")})` : "";
  return (
    <label className={`${styles.size} ${caption ? styles.captioned : ""}`} title={`Thumbnail size${keys}; double-click to reset`}>
      {caption ? <span className={styles.caption}>Thumbnail size</span> : <Icon name="grid" size={14} />}
      <input
        type="range"
        className={styles.sizeRange}
        aria-label="Thumbnail size"
        min={min}
        max={max}
        step={step}
        value={width}
        onChange={(e) => void dispatch("view.grid.size.set", { width: Number(e.target.value) })}
        onDoubleClick={() => void dispatch("view.grid.size.set")}
        onKeyDown={(e) => {
          // Global shortcuts pause while an input has focus; keep the step keys working on the slider itself.
          const direction = e.key === "=" || e.key === "+" ? "larger" : e.key === "-" ? "smaller" : null;
          if (!direction) return;
          e.preventDefault();
          void dispatch("view.grid.size.step", { direction });
        }}
      />
    </label>
  );
}
