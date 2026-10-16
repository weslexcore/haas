import { createStore } from "zustand/vanilla";

export interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
}

/** Transient UI notifications. Presentation state only, so it lives outside the app store. */
export const toastStore = createStore<{ toasts: Toast[] }>()(() => ({ toasts: [] }));

let nextId = 1;

export function toast(message: string, tone: Toast["tone"] = "info", ms = 4000): void {
  const id = nextId++;
  toastStore.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone }] }));
  setTimeout(() => dismissToast(id), ms);
}

export function dismissToast(id: number): void {
  toastStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
