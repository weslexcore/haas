import type { PhotoRecord } from "../../core/state/types";
import { useAppState, useDispatch } from "../hooks";
import { ActionButton } from "../shell/ActionButton";
import styles from "./CropBar.module.css";

const ASPECTS = ["original", "1:1", "4:5", "5:4", "2:3", "3:2", "16:9", "9:16"] as const;

/**
 * Crop controls shown over the photo when cropping outside Develop (Loupe),
 * where there is no side panel. Every control dispatches an action.
 */
export function CropBar({ photo }: { photo: PhotoRecord }) {
  const dispatch = useDispatch();
  const levelTool = useAppState((s) => s.develop.levelTool);
  const angle = photo.edit?.crop.angle ?? 0;

  return (
    <div className={styles.bar} role="toolbar" aria-label="Crop">
      <label className={styles.field}>
        Aspect
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) void dispatch("develop.crop.set", { aspect: e.target.value });
            e.target.value = "";
            e.target.blur(); // hand the keyboard back to shortcuts
          }}
        >
          <option value="" disabled>
            Choose…
          </option>
          {ASPECTS.map((a) => (
            <option key={a} value={a}>
              {a === "original" ? "Original" : a}
            </option>
          ))}
        </select>
      </label>
      <span className={styles.angle} aria-label="Straighten angle">
        {`${angle > 0 ? "+" : ""}${angle.toFixed(1)}°`}
      </span>
      <ActionButton actionId="develop.levelTool.toggle" className={styles.button} aria-pressed={levelTool}>
        Straighten
      </ActionButton>
      <button type="button" className={styles.button} onClick={() => void dispatch("develop.reset", { groups: ["crop"] })}>
        Reset
      </button>
      <ActionButton actionId="develop.cropTool.toggle" className={`${styles.button} ${styles.primary}`} label="Done">
        Done
      </ActionButton>
    </div>
  );
}
