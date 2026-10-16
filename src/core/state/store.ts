import { enablePatches } from "immer";
import { createStore, type StoreApi } from "zustand/vanilla";
import { initialState, type AppState } from "./types";

enablePatches();

export type AppStore = StoreApi<AppState>;

/**
 * The single app state store. Only actions change it (via ctx.update), so
 * every change is validated and, where undoable, recorded in history.
 */
export function createAppStore(overrides: Partial<AppState> = {}): AppStore {
  return createStore<AppState>()(() => ({ ...initialState, ...overrides }));
}
