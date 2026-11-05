import { createStore } from "zustand/vanilla";
import type { Runtime } from "../core/runtime";

export type PointerKind = "mouse" | "touch" | "pen";

/** Reactive mirror of runtime.input for UI indicators (e.g. Caps Lock → auto-advance), plus the last pointer used. */
export const inputStore = createStore<{ capsLock: boolean; pointerType: PointerKind }>()(() => ({ capsLock: false, pointerType: "mouse" }));

/** Record Caps Lock from any keyboard or mouse event, and which kind of pointer was last pressed. */
export function trackModifiers(runtime: Runtime, e: KeyboardEvent | MouseEvent): void {
  if ("pointerType" in e) {
    const pointerType = (e as PointerEvent).pointerType as PointerKind;
    if (pointerType && pointerType !== inputStore.getState().pointerType) inputStore.setState({ pointerType });
  }
  if (typeof e.getModifierState !== "function") return;
  const capsLock = e.getModifierState("CapsLock");
  if (capsLock !== runtime.input.capsLock) {
    runtime.input.capsLock = capsLock;
    inputStore.setState({ capsLock });
  }
}

/** The kind of pointer behind a click: from the event when the browser says, else the last pointer pressed. */
export function pointerKindOf(e: { nativeEvent: Event }): PointerKind {
  const native = e.nativeEvent as Partial<PointerEvent>;
  return (native.pointerType as PointerKind | undefined) || inputStore.getState().pointerType;
}
