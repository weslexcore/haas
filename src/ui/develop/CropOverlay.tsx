import { useRef, type PointerEvent } from "react";
import type { Size } from "../../core/develop/crop";
import type { CropRect } from "../../core/develop/recipe";
import { useRuntime } from "../runtime-context";
import styles from "./CropOverlay.module.css";

type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Exclude<Handle, "move">[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/**
 * Crop rectangle over the whole straightened frame: drag inside to move,
 * drag the handles to resize. Each change dispatches develop.crop.set
 * (coalesced into one undo step per gesture; the action keeps it inside the photo).
 */
export function CropOverlay({ crop, display }: { crop: CropRect; display: Size }) {
  const runtime = useRuntime();
  const drag = useRef<{ handle: Handle; start: { x: number; y: number }; crop: CropRect } | null>(null);

  const onDown = (handle: Handle) => (e: PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { handle, start: { x: e.clientX, y: e.clientY }, crop: { ...crop } };
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.start.x) / display.width;
    const dy = (e.clientY - d.start.y) / display.height;
    let { x, y, width, height } = d.crop;
    const right = x + width;
    const bottom = y + height;
    const h = d.handle;
    if (h === "move") {
      x = Math.min(1 - width, Math.max(0, x + dx));
      y = Math.min(1 - height, Math.max(0, y + dy));
    } else {
      if (h.includes("w")) x = Math.min(right - 0.02, Math.max(0, x + dx));
      if (h.includes("e")) width = Math.min(1 - x, Math.max(0.02, width + dx));
      if (h.includes("n")) y = Math.min(bottom - 0.02, Math.max(0, y + dy));
      if (h.includes("s")) height = Math.min(1 - y, Math.max(0.02, height + dy));
      if (h.includes("w")) width = right - x;
      if (h.includes("n")) height = bottom - y;
    }
    void runtime.dispatch("develop.crop.set", { x, y, width, height }, { source: "ui" });
  };

  const style = {
    left: crop.x * display.width,
    top: crop.y * display.height,
    width: crop.width * display.width,
    height: crop.height * display.height,
  };

  return (
    <div className={styles.overlay} onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
      <div className={styles.rect} style={style} onPointerDown={onDown("move")} aria-label="Crop area" role="group">
        <div className={styles.thirds} />
        {HANDLES.map((h) => (
          <div key={h} className={`${styles.handle} ${styles[h]}`} onPointerDown={onDown(h)} aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}
