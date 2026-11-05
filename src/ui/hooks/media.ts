import { useSyncExternalStore } from "react";

/**
 * The device traits the UI adapts to. They are independent: a phone is
 * both narrow and coarse, a tablet in landscape is usually only coarse, and
 * a narrow desktop window is only narrow.
 *
 * The CSS modules follow the JS decision for the layout (`html[data-layout]`,
 * set by App) and use the same (hover/pointer) media query for touch, since
 * CSS cannot read these constants.
 */

/**
 * The small-screen layout: bottom navigation, sheets instead of bars and
 * popups, no status bar. Narrow windows, and touch screens too short for the
 * desktop chrome (a phone held sideways).
 */
export const MOBILE_QUERY = "(max-width: 720px), ((hover: none) and (pointer: coarse) and (max-height: 520px))";
/** Narrow enough that the Develop controls go under the photo rather than beside it. */
export const STACK_QUERY = "(max-width: 720px)";
/** Touch-first device with no hover: bigger targets, long-press menus, no keyboard hints. */
export const COARSE_QUERY = "(hover: none) and (pointer: coarse)";

const lists = new Map<string, MediaQueryList>();
const listFor = (query: string) => {
  let list = lists.get(query);
  if (!list) {
    list = window.matchMedia(query);
    lists.set(query, list);
  }
  return list;
};

/** Whether a media query matches; re-renders when it changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const list = listFor(query);
      list.addEventListener("change", cb);
      return () => list.removeEventListener("change", cb);
    },
    () => listFor(query).matches,
    () => false,
  );
}

export const useMobileLayout = () => useMediaQuery(MOBILE_QUERY);
export const useStackedDevelop = () => useMediaQuery(STACK_QUERY);
export const useCoarsePointer = () => useMediaQuery(COARSE_QUERY);
