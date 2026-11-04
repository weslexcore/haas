import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

export interface DragState {
  /** Pointer position now, viewport px. */
  x: number;
  y: number;
  /** Movement since the gesture began. */
  dx: number;
  dy: number;
}

export interface DragHandlers {
  onStart?: (s: DragState, e: PointerEvent) => void;
  onMove: (s: DragState, e: PointerEvent) => void;
  onEnd?: (s: DragState, e: PointerEvent) => void;
  /** Cursor shown for the whole gesture (the pointer may leave the grabbed element). */
  cursor?: string;
}

/**
 * A pointer-capture drag gesture. Returns the pointerdown handler for the
 * element to grab. The latest handlers are always used, so callers can pass
 * fresh closures on every render.
 */
export function useDrag(handlers: DragHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  return useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    const state = (ev: PointerEvent): DragState => ({ x: ev.clientX, y: ev.clientY, dx: ev.clientX - startX, dy: ev.clientY - startY });
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    document.body.dataset.dragging = ref.current.cursor ?? "default";
    const move = (ev: PointerEvent) => ref.current.onMove(state(ev), ev);
    const end = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      delete document.body.dataset.dragging;
      ref.current.onEnd?.(state(ev), ev);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    ref.current.onStart?.(state(e.nativeEvent), e.nativeEvent);
  }, []);
}
