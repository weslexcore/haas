import { z } from "zod";
import type { ActionRegistry } from "../actions/registry";
import type { AnyAction, DispatchResult, ReadonlyContext, ShortcutBinding } from "../actions/types";
import { isAvailable, requiresParams } from "../actions/dispatcher";
import type { SettingsStore } from "../services";
import {
  formatChord,
  formatChordStrokes,
  normalizeChord,
  strokeFromEvent,
  tryNormalizeChord,
  type KeyEventLike,
} from "./combo";

export interface ResolvedBinding {
  /** Canonical chord. */
  keys: string;
  actionId: string;
  params?: unknown;
  allowInInput: boolean;
  origin: "default" | "user";
  /** Position within the action's binding list. */
  index: number;
}

export interface Conflict {
  /** exact: same keys. prefix: one binding's keys start another's chord, so the shorter one waits. */
  kind: "exact" | "prefix";
  keys: string;
  bindings: ResolvedBinding[];
}

/** User overrides: when present for an action, its list replaces the defaults entirely. */
export type Overrides = Record<string, ShortcutBinding[]>;

export interface KeyboardEventLike extends KeyEventLike {
  target?: unknown;
  preventDefault(): void;
}

export interface KeybindingDeps {
  registry: ActionRegistry;
  settings: SettingsStore;
  isMac: boolean;
  getContext: () => ReadonlyContext;
  dispatch: (id: string, params: unknown) => Promise<DispatchResult>;
  /** Called when a binding without params fires for an action that needs them. */
  onMissingParams: (actionId: string) => void;
  chordTimeoutMs?: number;
}

export const OVERRIDES_SETTINGS_KEY = "keybindings.overrides";

const bindingSchema = z.object({
  keys: z.string(),
  params: z.unknown().optional(),
  allowInInput: z.boolean().optional(),
});
const exportSchema = z.object({
  version: z.literal(1),
  overrides: z.record(z.string(), z.array(bindingSchema)),
});

export class KeybindingService {
  private overrides: Overrides = {};
  private cache: ResolvedBinding[] | null = null;
  private pending: string[] = [];
  private pendingFallback: ResolvedBinding | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private suspended = false;
  private version = 0;
  private listeners = new Set<() => void>();
  private pendingListeners = new Set<() => void>();

  constructor(private readonly deps: KeybindingDeps) {}

  get isMac(): boolean {
    return this.deps.isMac;
  }

  async load(): Promise<void> {
    const stored = await this.deps.settings.get<unknown>(OVERRIDES_SETTINGS_KEY);
    const parsed = z.record(z.string(), z.array(bindingSchema)).safeParse(stored);
    this.overrides = parsed.success ? (parsed.data as Overrides) : {};
    this.changed(false);
  }

  // ── Queries ──────────────────────────────────────────────────────────

  bindings(): ResolvedBinding[] {
    if (this.cache) return this.cache;
    const out: ResolvedBinding[] = [];
    for (const action of this.deps.registry.all()) out.push(...this.resolveFor(action));
    this.cache = out;
    return out;
  }

  bindingsFor(actionId: string): ResolvedBinding[] {
    return this.bindings().filter((b) => b.actionId === actionId);
  }

  isOverridden(actionId: string): boolean {
    return actionId in this.overrides;
  }

  conflicts(): Conflict[] {
    const all = this.bindings();
    const conflicts: Conflict[] = [];
    const byKeys = new Map<string, ResolvedBinding[]>();
    for (const b of all) byKeys.set(b.keys, [...(byKeys.get(b.keys) ?? []), b]);
    for (const [keys, group] of byKeys) {
      if (group.length > 1) conflicts.push({ kind: "exact", keys, bindings: group });
    }
    for (const short of all) {
      for (const long of all) {
        if (long.keys.startsWith(short.keys + " ")) {
          conflicts.push({ kind: "prefix", keys: short.keys, bindings: [short, long] });
        }
      }
    }
    return conflicts;
  }

  format(keys: string): string {
    return formatChord(keys, this.deps.isMac);
  }

  formatStrokes(keys: string): string[] {
    return formatChordStrokes(keys, this.deps.isMac);
  }

  // ── Mutations ────────────────────────────────────────────────────────

  /** Replace an action's whole binding list. Throws KeyComboError on malformed keys. */
  setBindings(actionId: string, bindings: ShortcutBinding[]): void {
    const action = this.requireAction(actionId);
    const normalized = bindings.map((b) => ({ ...b, keys: normalizeChord(b.keys, this.deps.isMac) }));
    const defaults = this.defaultsFor(action);
    if (sameBindings(normalized, defaults)) delete this.overrides[actionId];
    else this.overrides[actionId] = normalized;
    this.changed(true);
  }

  addBinding(actionId: string, keys: string, params?: unknown): void {
    const current = this.currentList(actionId);
    this.setBindings(actionId, [...current, params === undefined ? { keys } : { keys, params }]);
  }

  replaceKeys(actionId: string, index: number, keys: string): void {
    const current = this.currentList(actionId);
    if (!current[index]) throw new Error(`No binding ${index} for "${actionId}".`);
    this.setBindings(
      actionId,
      current.map((b, i) => (i === index ? { ...b, keys } : b)),
    );
  }

  removeBinding(actionId: string, index: number): void {
    this.setBindings(
      actionId,
      this.currentList(actionId).filter((_, i) => i !== index),
    );
  }

  resetToDefault(actionId: string): void {
    delete this.overrides[actionId];
    this.changed(true);
  }

  resetAll(): void {
    this.overrides = {};
    this.changed(true);
  }

  exportJSON(): string {
    return JSON.stringify({ version: 1, overrides: this.overrides }, null, 2);
  }

  /** Replaces all overrides. Returns ids of skipped (unknown) actions. Throws on malformed JSON. */
  importJSON(json: string): { imported: number; skipped: string[] } {
    const data = exportSchema.parse(JSON.parse(json));
    const next: Overrides = {};
    const skipped: string[] = [];
    for (const [actionId, list] of Object.entries(data.overrides)) {
      if (!this.deps.registry.get(actionId)) {
        skipped.push(actionId);
        continue;
      }
      next[actionId] = list.map((b) => ({ ...b, keys: normalizeChord(b.keys, this.deps.isMac) }));
    }
    this.overrides = next;
    this.changed(true);
    return { imported: Object.keys(next).length, skipped };
  }

  /** Pause shortcut handling, e.g. while the shortcut recorder is capturing keys. */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    this.clearPending();
  }

  // ── Event handling ───────────────────────────────────────────────────

  /**
   * Returns true when the event was consumed by a binding (or a pending chord).
   * While a modal is open only bindings that allow text input fire, so keys
   * typed into the palette or settings never trigger app shortcuts.
   */
  handleKeyDown(e: KeyboardEventLike, opts: { modalOpen?: boolean } = {}): boolean {
    if (this.suspended) return false;
    const stroke = strokeFromEvent(e, this.deps.isMac);
    if (!stroke) return false;

    const inInput = !!opts.modalOpen || isEditableTarget(e.target);
    const ctx = this.deps.getContext();
    const candidates = this.bindings()
      .filter((b) => (!inInput || b.allowInInput) && this.isBindingAvailable(b, ctx))
      // User bindings win over defaults on exact conflicts.
      .sort((a, b) => (a.origin === b.origin ? 0 : a.origin === "user" ? -1 : 1));

    const match = (seq: string[]) => {
      const chord = seq.join(" ");
      return {
        seq,
        exact: candidates.find((b) => b.keys === chord) ?? null,
        longer: candidates.some((b) => b.keys.startsWith(chord + " ")),
      };
    };

    const fallback = this.pendingFallback;
    let m = match([...this.pending, stroke]);
    if (!m.exact && !m.longer && this.pending.length > 0) {
      // The chord was abandoned: run the shorter binding it was waiting on, then treat this stroke fresh.
      if (fallback) this.fire(fallback);
      m = match([stroke]);
    }
    this.clearPending();

    if (m.longer) {
      e.preventDefault();
      this.pending = m.seq;
      this.pendingFallback = m.exact;
      this.pendingTimer = setTimeout(() => {
        const fallback = this.pendingFallback;
        this.clearPending();
        if (fallback) this.fire(fallback);
      }, this.deps.chordTimeoutMs ?? 800);
      this.emitPending();
      return true;
    }
    if (m.exact) {
      e.preventDefault();
      this.fire(m.exact);
      return true;
    }
    return false;
  }

  /** Strokes typed so far in an unfinished chord (for a status hint). */
  get pendingChord(): string | null {
    return this.pending.length ? this.pending.join(" ") : null;
  }

  // ── useSyncExternalStore plumbing ────────────────────────────────────

  getVersion = (): number => this.version;

  /** Subscribe to changes of `pendingChord`. */
  subscribePending = (listener: () => void): (() => void) => {
    this.pendingListeners.add(listener);
    return () => this.pendingListeners.delete(listener);
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // ── Internals ────────────────────────────────────────────────────────

  private fire(binding: ResolvedBinding): void {
    const action = this.deps.registry.get(binding.actionId);
    if (!action) return;
    if (binding.params === undefined && requiresParams(action)) {
      this.deps.onMissingParams(action.id);
      return;
    }
    void this.deps.dispatch(binding.actionId, binding.params);
  }

  private isBindingAvailable(b: ResolvedBinding, ctx: ReadonlyContext): boolean {
    const action = this.deps.registry.get(b.actionId);
    return !!action && isAvailable(action, ctx);
  }

  private resolveFor(action: AnyAction): ResolvedBinding[] {
    const user = this.overrides[action.id];
    const list: ShortcutBinding[] = user ?? this.defaultsFor(action);
    const origin = user ? "user" : "default";
    const out: ResolvedBinding[] = [];
    list.forEach((b, index) => {
      const keys = tryNormalizeChord(b.keys, this.deps.isMac);
      if (!keys) {
        console.warn(`Ignoring malformed shortcut "${b.keys}" for ${action.id}`);
        return;
      }
      out.push({
        keys,
        actionId: action.id,
        ...(b.params !== undefined ? { params: b.params } : {}),
        allowInInput: !!b.allowInInput,
        origin,
        index,
      });
    });
    return out;
  }

  private defaultsFor(action: AnyAction): ShortcutBinding[] {
    return (action.defaultShortcuts ?? []).map((b: ShortcutBinding) => ({
      ...b,
      keys: tryNormalizeChord(b.keys, this.deps.isMac) ?? b.keys,
    }));
  }

  private currentList(actionId: string): ShortcutBinding[] {
    const action = this.requireAction(actionId);
    return this.overrides[actionId] ?? this.defaultsFor(action);
  }

  private requireAction(actionId: string): AnyAction {
    const action = this.deps.registry.get(actionId);
    if (!action) throw new Error(`No action with id "${actionId}".`);
    return action;
  }

  private changed(persist: boolean): void {
    this.cache = null;
    this.version++;
    if (persist) {
      this.deps.settings.set(OVERRIDES_SETTINGS_KEY, this.overrides).catch((err) => {
        console.error("Failed to save keybindings", err);
      });
    }
    for (const l of this.listeners) l();
  }

  private clearPending(): void {
    const had = this.pending.length > 0;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    this.pending = [];
    this.pendingFallback = null;
    if (had) this.emitPending();
  }

  private emitPending(): void {
    for (const l of this.pendingListeners) l();
  }
}

function sameBindings(a: ShortcutBinding[], b: ShortcutBinding[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.keys === b[i]?.keys &&
        !!x.allowInInput === !!b[i]?.allowInInput &&
        JSON.stringify(x.params) === JSON.stringify(b[i]?.params),
    )
  );
}

const NON_TEXT_INPUT_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset", "color", "file", "image"]);

export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const t = target as { tagName?: string; isContentEditable?: boolean; type?: string };
  if (t.isContentEditable) return true;
  const tag = t.tagName?.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has((t.type ?? "text").toLowerCase());
  return false;
}
