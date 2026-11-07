import { useRef, useState, type PointerEvent } from "react";
import { resizeCrop, rotateByDrag, type CropHandle, type Point, type Size } from "../../core/develop/crop";
import type { CropRect } from "../../core/develop/recipe";
import { useRuntime } from "../runtime-context";
import styles from "./CropOverlay.module.css";

type Handle = "move" | CropHandle;
const HANDLES: CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

type Drag =
  | { kind: "resize"; handle: Handle; start: Point; crop: CropRect }
  | { kind: "rotate"; center: Point; start: Point; crop: CropRect }
  | { kind: "level"; start: Point };

/**
 * Crop rectangle over the whole straightened frame:
 * - drag inside to move it, drag the handles to resize (hold Shift to keep
 *   the aspect ratio);
 * - drag outside it (on the photo or the margin around it) to rotate;
 * - ⌘/Ctrl-drag, or drag with the straighten tool armed, to draw a line
 *   along a horizon and level the photo to it.
 * Each change dispatches a develop action (a drag coalesces into one undo
 * step; the action keeps the crop inside the photo).
 */
export function CropOverlay({ crop, display, levelTool }: { crop: CropRect; display: Size; levelTool: boolean }) {
  const runtime = useRuntime();
  const drag = useRef<Drag | null>(null);
  const [rotating, setRotating] = useState(false);
  /** Resizing with Shift held: the hint says the shape is kept. */
  const [locked, setLocked] = useState(false);
  const [line, setLine] = useState<{ from: Point; to: Point } | null>(null);
  const dispatch = (id: string, params: unknown) => void runtime.dispatch(id, params, { source: "ui" });

  /** Pointer position in display px, relative to the photo's top-left. */
  const pointOf = (e: PointerEvent): Point => {
    const frame = (e.currentTarget as HTMLElement).closest(`.${styles.overlay}`)!.getBoundingClientRect();
    return { x: e.clientX - frame.left, y: e.clientY - frame.top };
  };

  const begin = (e: PointerEvent, next: Drag) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = next;
  };

  const onDown = (handle: Handle | "outside") => (e: PointerEvent) => {
    if (e.button !== 0) return;
    const start = pointOf(e);
    if (levelTool || e.metaKey || e.ctrlKey) {
      begin(e, { kind: "level", start });
      setLine({ from: start, to: start });
    } else if (handle === "outside") {
      const center = { x: (crop.x + crop.width / 2) * display.width, y: (crop.y + crop.height / 2) * display.height };
      begin(e, { kind: "rotate", center, start, crop: { ...crop } });
      setRotating(true);
    } else {
      begin(e, { kind: "resize", handle, start, crop: { ...crop } });
    }
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = pointOf(e);
    if (d.kind === "level") return setLine({ from: d.start, to: p });
    if (d.kind === "rotate") {
      // From the crop at the start of the drag, so rotating back regrows it.
      const { x, y, width, height } = d.crop;
      return dispatch("develop.crop.set", { angle: rotateByDrag(d.crop.angle, d.center, d.start, p), x, y, width, height });
    }
    const dx = (p.x - d.start.x) / display.width;
    const dy = (p.y - d.start.y) / display.height;
    let { x, y, width, height } = d.crop;
    if (d.handle === "move") {
      x = Math.min(1 - width, Math.max(0, x + dx));
      y = Math.min(1 - height, Math.max(0, y + dy));
    } else {
      // Shift (read on every move, so it can be pressed or released mid-drag) keeps the shape.
      setLocked(e.shiftKey);
      ({ x, y, width, height } = resizeCrop(d.crop, d.handle, dx, dy, e.shiftKey));
    }
    dispatch("develop.crop.set", { x, y, width, height });
  };

  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setRotating(false);
    setLocked(false);
    if (d?.kind !== "level") return;
    setLine(null);
    const to = pointOf(e);
    const frac = (p: Point) => ({
      x: Math.min(1, Math.max(0, p.x / display.width)),
      y: Math.min(1, Math.max(0, p.y / display.height)),
    });
    if (Math.hypot(to.x - d.start.x, to.y - d.start.y) >= 8) dispatch("develop.crop.level", { from: frac(d.start), to: frac(to) });
    if (levelTool) dispatch("develop.levelTool.toggle", { on: false });
  };

  const style = {
    left: crop.x * display.width,
    top: crop.y * display.height,
    width: crop.width * display.width,
    height: crop.height * display.height,
  };
  // On the root: pointer capture sends moves to the pressed element, and they bubble here.
  const handlers = { onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp };

  return (
    <div className={`${styles.overlay} ${levelTool ? styles.leveling : ""}`} {...handlers}>
      <div className={styles.rotateZone} onPointerDown={onDown("outside")} aria-hidden="true" />
      <div className={styles.rect} style={style} onPointerDown={onDown("move")} aria-label="Crop area" role="group">
        <div className={rotating ? styles.fineGrid : styles.thirds} />
        {HANDLES.map((h) => (
          <div key={h} className={`${styles.handle} ${styles[h]}`} onPointerDown={onDown(h)} aria-hidden="true" />
        ))}
      </div>
      {line && (
        <svg className={styles.line} width={display.width} height={display.height} aria-hidden="true">
          <line x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} />
        </svg>
      )}
      <p className={styles.hint} role="status">
        {levelTool ? "Draw a line along the horizon or a vertical edge" : rotating ? `${crop.angle > 0 ? "+" : ""}${crop.angle.toFixed(1)}°` : locked ? "Aspect ratio locked" : ""}
      </p>
    </div>
  );
}
