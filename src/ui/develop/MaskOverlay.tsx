import { useRef, useState, type PointerEvent } from "react";
import { applyAffine, cropToSourceAffine, invertAffine, type Point, type Size } from "../../core/develop/crop";
import type { CropRect, Mask, MaskPoint, MaskShape } from "../../core/develop/recipe";
import type { PhotoRecord } from "../../core/state/types";
import { useRuntime } from "../runtime-context";
import styles from "./MaskOverlay.module.css";

type RadialHandle = "center" | "x+" | "x-" | "y+" | "y-";
type HandleDrag =
  | { kind: "linear"; handle: "from" | "to" | "both"; shape: Extract<MaskShape, { type: "linear" }> }
  | { kind: "radial"; handle: RadialHandle; shape: Extract<MaskShape, { type: "radial" }> };
type Drag = (HandleDrag & { start: MaskPoint }) | { kind: "draw"; type: "linear" | "radial"; start: MaskPoint };
type OnHandleDown = (next: HandleDrag) => (e: PointerEvent) => void;

const MIN_RADIUS = 0.02;
const clampUv = (v: number) => Math.min(2, Math.max(-1, v));

/**
 * Handles for the selected mask over the rendered photo, and drawing of new
 * gradients. Masks live in source uv (the uncropped photo), so positions go
 * through the crop's affine map both ways: handles are drawn where the
 * mask's points land in the rendered (cropped, straightened) frame, and a
 * drag is turned back into source uv. Each change dispatches
 * develop.mask.update (a drag coalesces into one undo step); a finished
 * drawing drag dispatches develop.mask.add.
 */
export function MaskOverlay({ photo, mask, crop, display, drawing }: { photo: PhotoRecord; mask: Mask | null; crop: CropRect; display: Size; drawing: "linear" | "radial" | null }) {
  const runtime = useRuntime();
  const drag = useRef<Drag | null>(null);
  const [sketch, setSketch] = useState<MaskShape | null>(null);
  const dispatch = (id: string, params: unknown) => void runtime.dispatch(id, params, { source: "ui" });

  // The photo's pixel shape (only the aspect ratio matters); 3:2 until it is indexed.
  const src = photo.width && photo.height ? { width: photo.width, height: photo.height } : { width: 3, height: 2 };
  const aspect = src.width / src.height;
  const toSource = cropToSourceAffine(src, crop);
  const toOutput = invertAffine(toSource);
  /** Source uv → display px. */
  const toPx = (p: MaskPoint): Point => {
    const [u, v] = applyAffine(toOutput, p.x, p.y);
    return { x: u * display.width, y: v * display.height };
  };
  /** Display px → source uv. */
  const toUv = (p: Point): MaskPoint => {
    const [u, v] = applyAffine(toSource, p.x / display.width, p.y / display.height);
    return { x: clampUv(u), y: clampUv(v) };
  };
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

  const onHandleDown: OnHandleDown = (next) => (e) => {
    if (e.button !== 0) return;
    begin(e, { ...next, start: toUv(pointOf(e)) });
  };

  const onBackgroundDown = (e: PointerEvent) => {
    if (e.button !== 0 || !drawing) return;
    const start = toUv(pointOf(e));
    begin(e, { kind: "draw", type: drawing, start });
    setSketch(drawing === "linear" ? { type: "linear", from: start, to: start } : { type: "radial", center: start, radiusX: MIN_RADIUS, radiusY: MIN_RADIUS, angle: 0, feather: 50 });
  };

  /** The ellipse's radii from a point, in its own (rotated) frame: distances in units of the height, x as a fraction of the width. */
  const radiiFrom = (shape: Extract<MaskShape, { type: "radial" }>, p: MaskPoint) => {
    const dx = (p.x - shape.center.x) * aspect;
    const dy = p.y - shape.center.y;
    const t = (shape.angle * Math.PI) / 180;
    const rx = Math.cos(t) * dx + Math.sin(t) * dy;
    const ry = -Math.sin(t) * dx + Math.cos(t) * dy;
    return { rx: Math.abs(rx) / aspect, ry: Math.abs(ry) };
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toUv(pointOf(e));
    if (d.kind === "draw") {
      if (d.type === "linear") return setSketch({ type: "linear", from: d.start, to: p });
      return setSketch({ type: "radial", center: d.start, radiusX: Math.max(MIN_RADIUS, Math.abs(p.x - d.start.x)), radiusY: Math.max(MIN_RADIUS, Math.abs(p.y - d.start.y)), angle: 0, feather: 50 });
    }
    if (!mask) return;
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    let shape: MaskShape;
    if (d.kind === "linear") {
      const move = (q: MaskPoint) => ({ x: clampUv(q.x + dx), y: clampUv(q.y + dy) });
      shape = {
        ...d.shape,
        from: d.handle === "to" ? d.shape.from : move(d.shape.from),
        to: d.handle === "from" ? d.shape.to : move(d.shape.to),
      };
    } else {
      if (d.handle === "center") shape = { ...d.shape, center: { x: clampUv(d.shape.center.x + dx), y: clampUv(d.shape.center.y + dy) } };
      else {
        const { rx, ry } = radiiFrom(d.shape, p);
        shape = d.handle.startsWith("x") ? { ...d.shape, radiusX: Math.min(2, Math.max(MIN_RADIUS, rx)) } : { ...d.shape, radiusY: Math.min(2, Math.max(MIN_RADIUS, ry)) };
      }
    }
    dispatch("develop.mask.update", { maskId: mask.id, shape });
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind !== "draw") return;
    const shape = sketch;
    setSketch(null);
    if (!shape) return;
    // A tap (no movement) makes nothing: there is no gradient to draw.
    if (shape.type === "linear" && Math.hypot((shape.to.x - shape.from.x) * aspect, shape.to.y - shape.from.y) < 0.01) return dispatch("develop.mask.draw", { shape: null });
    if (shape.type === "radial" && shape.radiusX <= MIN_RADIUS && shape.radiusY <= MIN_RADIUS) return dispatch("develop.mask.draw", { shape: null });
    dispatch("develop.mask.add", { shape });
  };

  const shown = sketch ?? mask?.shape ?? null;
  const handlers = { onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp };
  const interactive = !!drawing;

  return (
    <div
      className={`${styles.overlay} ${interactive ? styles.drawing : ""}`}
      onPointerDown={onBackgroundDown}
      role={interactive ? "application" : undefined}
      aria-label={interactive ? `Drag to draw a ${drawing} gradient mask` : undefined}
      {...handlers}
    >
      {shown?.type === "linear" && <LinearHandles shape={shown} toPx={toPx} display={display} sketch={!!sketch} onDown={onHandleDown} />}
      {shown?.type === "radial" && <RadialHandles shape={shown} toPx={toPx} aspect={aspect} sketch={!!sketch} onDown={onHandleDown} />}
      {drawing && !sketch && (
        <p className={styles.hint} role="status">
          {drawing === "linear" ? "Drag from where the mask is full to where it fades out" : "Drag from the centre of the ellipse to its edge"}
        </p>
      )}
    </div>
  );
}

/** Two lines across the frame through `from` and `to`, a connector, and three handles (ends and middle). */
function LinearHandles({ shape, toPx, display, sketch, onDown }: { shape: Extract<MaskShape, { type: "linear" }>; toPx: (p: MaskPoint) => Point; display: Size; sketch: boolean; onDown: OnHandleDown }) {
  const a = toPx(shape.from);
  const b = toPx(shape.to);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // Perpendicular direction, long enough to cross the frame.
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = (-(b.y - a.y) / len) * (display.width + display.height);
  const ny = ((b.x - a.x) / len) * (display.width + display.height);
  const across = (p: Point) => ({ x1: p.x - nx, y1: p.y - ny, x2: p.x + nx, y2: p.y + ny });
  const handle = (p: Point, which: "from" | "to" | "both", label: string) => (
    <div
      className={`${styles.handle} ${which === "both" ? styles.move : ""}`}
      style={{ left: p.x, top: p.y }}
      role="slider"
      aria-label={label}
      aria-valuetext={`${Math.round(p.x)}, ${Math.round(p.y)}`}
      tabIndex={-1}
      onPointerDown={sketch ? undefined : onDown({ kind: "linear", handle: which, shape })}
    />
  );
  return (
    <>
      <svg className={styles.lines} width={display.width} height={display.height} aria-hidden="true">
        <line {...across(a)} className={styles.edgeFull} />
        <line {...across(b)} className={styles.edgeEmpty} />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={styles.connector} />
      </svg>
      {!sketch && handle(a, "from", "Where the mask is full")}
      {!sketch && handle(b, "to", "Where the mask fades out")}
      {!sketch && handle(mid, "both", "Move the gradient")}
    </>
  );
}

/** The ellipse's outline, its centre handle and one handle at each end of its two axes. */
function RadialHandles({ shape, toPx, aspect, sketch, onDown }: { shape: Extract<MaskShape, { type: "radial" }>; toPx: (p: MaskPoint) => Point; aspect: number; sketch: boolean; onDown: OnHandleDown }) {
  const t = (shape.angle * Math.PI) / 180;
  const c = shape.center;
  // Axis end points in source uv: the x axis is rx of the width along the rotated direction, the y axis ry of the height.
  const axis = (sx: number, sy: number): MaskPoint => ({
    x: c.x + sx * shape.radiusX * Math.cos(t) - (sy * shape.radiusY * Math.sin(t)) / aspect,
    y: c.y + sx * shape.radiusX * Math.sin(t) * aspect + sy * shape.radiusY * Math.cos(t),
  });
  const C = toPx(c);
  const X = toPx(axis(1, 0));
  const Y = toPx(axis(0, 1));
  const rx = Math.hypot(X.x - C.x, X.y - C.y);
  const ry = Math.hypot(Y.x - C.x, Y.y - C.y);
  const rotation = (Math.atan2(X.y - C.y, X.x - C.x) * 180) / Math.PI;
  const handle = (p: Point, which: RadialHandle, label: string) => (
    <div
      key={which}
      className={`${styles.handle} ${which === "center" ? styles.move : ""}`}
      style={{ left: p.x, top: p.y }}
      role="slider"
      aria-label={label}
      aria-valuetext={`${Math.round(p.x)}, ${Math.round(p.y)}`}
      tabIndex={-1}
      onPointerDown={sketch ? undefined : onDown({ kind: "radial", handle: which, shape })}
    />
  );
  return (
    <>
      <svg className={styles.lines} aria-hidden="true">
        <ellipse cx={C.x} cy={C.y} rx={rx} ry={ry} transform={`rotate(${rotation} ${C.x} ${C.y})`} className={styles.ellipse} />
      </svg>
      {!sketch && handle(C, "center", "Move the ellipse")}
      {!sketch && handle(X, "x+", "Horizontal radius")}
      {!sketch && handle(toPx(axis(-1, 0)), "x-", "Horizontal radius (other side)")}
      {!sketch && handle(Y, "y+", "Vertical radius")}
      {!sketch && handle(toPx(axis(0, -1)), "y-", "Vertical radius (other side)")}
    </>
  );
}
