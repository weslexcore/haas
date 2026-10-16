import { createStore } from "zustand/vanilla";
import type { Runtime } from "../core/runtime";

/** Reactive mirror of runtime.input for UI indicators (e.g. Caps Lock → auto-advance). */
export const inputStore = createStore<{ capsLock: boolean }>()(() => ({ capsLock: false }));

/** Record Caps Lock from any keyboard or mouse event. */
export function trackModifiers(runtime: Runtime, e: KeyboardEvent | MouseEvent): void {
  if (typeof e.getModifierState !== "function") return;
  const capsLock = e.getModifierState("CapsLock");
  if (capsLock !== runtime.input.capsLock) {
    runtime.input.capsLock = capsLock;
    inputStore.setState({ capsLock });
  }
}
