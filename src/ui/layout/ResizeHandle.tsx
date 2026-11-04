import { useRef, type KeyboardEvent } from "react";
import { useDrag } from "./useDrag";
import styles from "./ResizeHandle.module.css";

interface Props {
  /** A vertical handle sits between side-by-side panes (drag left/right); a horizontal one between stacked panes. */
  orientation: "vertical" | "horizontal";
  label: string;
  value: number;
  min: number;
  max: number;
  /** Which way the pointer moves to grow `value`: +1 for right/down, -1 for left/up. */
  grow: 1 | -1;
  onResize: (value: number) => void;
  /** Double-click (or Escape while focused) restores the default size. */
  onReset?: () => void;
  className?: string;
}

const KEY_STEP = 16;

/** Draggable divider between two panes. Keyboard: arrow keys resize, Home/End go to the limits. */
export function ResizeHandle({ orientation, label, value, min, max, grow, onResize, onReset, className }: Props) {
  const startValue = useRef(value);
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)));
  const vertical = orientation === "vertical";
  const onPointerDown = useDrag({
    cursor: vertical ? "col-resize" : "row-resize",
    onStart: () => {
      startValue.current = value;
    },
    onMove: (s) => onResize(clamp(startValue.current + grow * (vertical ? s.dx : s.dy))),
  });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const forward = vertical ? "ArrowRight" : "ArrowDown";
    const back = vertical ? "ArrowLeft" : "ArrowUp";
    let next: number | undefined;
    if (e.key === forward) next = value + grow * KEY_STEP;
    else if (e.key === back) next = value - grow * KEY_STEP;
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    else if (e.key === "Escape" && onReset) {
      e.preventDefault();
      onReset();
      return;
    }
    if (next === undefined) return;
    e.preventDefault();
    onResize(clamp(next));
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      title={onReset ? `${label}: drag to resize, double-click to reset` : `${label}: drag to resize`}
      className={`${styles.handle} ${vertical ? styles.vertical : styles.horizontal} ${className ?? ""}`}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
