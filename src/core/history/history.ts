import { applyPatches, type Patch } from "immer";
import type { StoreApi } from "zustand/vanilla";
import type { AppState } from "../state/types";
import type { DispatchSource } from "../actions/types";

/**
 * A side effect outside app state (e.g. moving files) that an undo step must
 * reverse. undo() runs before the inverse patches, redo() before the patches.
 * Each should either fully succeed or leave things as they were and throw.
 */
export interface HistoryEffect {
  undo(): Promise<void>;
  redo(): Promise<void>;
}

export interface HistoryEntry {
  label: string;
  source: DispatchSource;
  patches: Patch[];
  inverse: Patch[];
  at: number;
  effects?: HistoryEffect[];
  /** Consecutive entries with the same key, close together in time, merge into one (e.g. a slider drag). */
  coalesceKey?: string;
}

const COALESCE_MS = 1500;

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
  /** An undo/redo with effects is in progress; further requests are ignored until it finishes. */
  private busy = false;
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

  /** While suspended (e.g. an AI plan preview), new entries are discarded. */
  private suspended = 0;

  async withoutRecording<T>(fn: () => Promise<T>): Promise<T> {
    this.suspended++;
    try {
      return await fn();
    } finally {
      this.suspended--;
    }
  }

  push(entry: HistoryEntry): void {
    if (this.suspended > 0) return;
    if (entry.patches.length === 0 && !entry.effects?.length) return;
    const last = this.past.at(-1);
    if (
      entry.coalesceKey &&
      last?.coalesceKey === entry.coalesceKey &&
      !last.effects?.length &&
      !entry.effects?.length &&
      entry.at - last.at < COALESCE_MS
    ) {
      last.patches.push(...entry.patches);
      last.inverse = [...entry.inverse, ...last.inverse];
      last.at = entry.at;
      last.label = entry.label;
      this.future = [];
      this.emit();
      return;
    }
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

  /** Undo the last entry. If one of its effects fails, nothing changes and the error is rethrown. */
  async undo(): Promise<boolean> {
    const entry = this.past.at(-1);
    if (!entry || this.busy) return false;
    this.busy = true;
    try {
      for (const effect of (entry.effects ?? []).toReversed()) await effect.undo();
      this.store.setState(applyPatches(this.store.getState(), entry.inverse), true);
      this.past.pop();
      this.future.push(entry);
      this.emit();
      return true;
    } finally {
      this.busy = false;
    }
  }

  async redo(): Promise<boolean> {
    const entry = this.future.at(-1);
    if (!entry || this.busy) return false;
    this.busy = true;
    try {
      for (const effect of entry.effects ?? []) await effect.redo();
      this.store.setState(applyPatches(this.store.getState(), entry.patches), true);
      this.future.pop();
      this.past.push(entry);
      this.emit();
      return true;
    } finally {
      this.busy = false;
    }
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
