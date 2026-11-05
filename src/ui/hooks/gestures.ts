import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type SyntheticEvent } from "react";

export interface Point {
  x: number;
  y: number;
}

/** Movement beyond which a press is a drag, not a tap or a long press. */
const SLOP = 10;

/**
 * Long press with a finger (not a mouse: it has a right button). Spread the
 * returned handlers on the element. The press that opened something is not
 * also a click, and the browser's own long-press context menu is suppressed
 * so the menu never opens twice.
 */
export function useLongPress(onLongPress: (at: Point) => void, delay = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef<Point>({ x: 0, y: 0 });
  const touching = useRef(false);
  const fired = useRef(false);
  const latest = useRef(onLongPress);
  latest.current = onLongPress;

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    touching.current = false;
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      fired.current = false;
      if (e.pointerType !== "touch" || !e.isPrimary) return;
      touching.current = true;
      origin.current = { x: e.clientX, y: e.clientY };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = undefined;
        fired.current = true;
        latest.current(origin.current);
      }, delay);
    },
    [delay],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (timer.current !== undefined && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > SLOP) cancel();
    },
    [cancel],
  );

  /** Swallows the click that follows a long press, so the menu isn't closed by it (or the item activated). */
  const onClickCapture = useCallback((e: SyntheticEvent) => {
    if (!fired.current) return;
    fired.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /** Android fires contextmenu on a long touch; the press handler already dealt with it. */
  const onContextMenu = useCallback((e: ReactMouseEvent) => {
    if (touching.current || fired.current) e.preventDefault();
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp: cancel, onPointerCancel: cancel, onClickCapture, onContextMenu };
}

/**
 * Horizontal swipe with a finger. `onSwipe(-1)` for a swipe to the left (next),
 * `onSwipe(1)` for a swipe to the right (previous). The element should allow
 * vertical panning only (`touch-action: pan-y`) so the browser hands horizontal
 * movement to pointer events.
 */
export function useSwipe(onSwipe: (direction: -1 | 1) => void, threshold = 48) {
  const start = useRef<Point | null>(null);
  const latest = useRef(onSwipe);
  latest.current = onSwipe;

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    start.current = e.pointerType === "touch" && e.isPrimary ? { x: e.clientX, y: e.clientY } : null;
  }, []);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 1.5) latest.current(dx < 0 ? -1 : 1);
    },
    [threshold],
  );

  const onPointerCancel = useCallback(() => {
    start.current = null;
  }, []);

  return { onPointerDown, onPointerUp, onPointerCancel };
}
