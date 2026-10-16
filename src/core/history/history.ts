import { applyPatches, type Patch } from "immer";
import type { StoreApi } from "zustand/vanilla";
import type { AppState } from "../state/types";
import type { DispatchSource } from "../actions/types";

export interface HistoryEntry {
  label: string;
  source: DispatchSource;
  patches: Patch[];
  inverse: Patch[];
  at: number;
}

export interface HistorySnapshot {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

const MAX_ENTRIES = 200;

/**
 * Patch-based undo/redo. Commands never write inverse logic: their state
 * changes are recorded as Immer patches and replayed in reverse.
 */
export class History {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private listeners = new Set<() => void>();
  private snapshot: HistorySnapshot = { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null };

  constructor(private readonly store: StoreApi<AppState>) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get entries(): readonly HistoryEntry[] {
    return this.past;
  }

  push(entry: HistoryEntry): void {
    if (entry.patches.length === 0) return;
    this.past.push(entry);
    if (this.past.length > MAX_ENTRIES) this.past.shift();
    this.future = [];
    this.emit();
  }

  /** Forget all entries, e.g. when the photos they refer to are replaced. */
  clear(): void {
    if (!this.past.length && !this.future.length) return;
    this.past = [];
    this.future = [];
    this.emit();
  }

  undo(): boolean {
    const entry = this.past.pop();
    if (!entry) return false;
    this.store.setState(applyPatches(this.store.getState(), entry.inverse), true);
    this.future.push(entry);
    this.emit();
    return true;
  }

  redo(): boolean {
    const entry = this.future.pop();
    if (!entry) return false;
    this.store.setState(applyPatches(this.store.getState(), entry.patches), true);
    this.past.push(entry);
    this.emit();
    return true;
  }

  getSnapshot = (): HistorySnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    this.snapshot = {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoLabel: this.past.at(-1)?.label ?? null,
      redoLabel: this.future.at(-1)?.label ?? null,
    };
    for (const l of this.listeners) l();
  }
}
