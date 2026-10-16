import { applyPatches, produceWithPatches, type Patch } from "immer";
import { z } from "zod";
import type { StoreApi } from "zustand/vanilla";
import type { AppState } from "../state/types";
import type { Services } from "../services";
import type { History } from "../history/history";
import type { ActionRegistry } from "./registry";
import type { KeybindingService } from "../keybindings/service";
import type { MenuRegistry } from "../menus/registry";
import type { AppContext, AnyAction, DispatchResult, DispatchSource, InputState, Platform, ReadonlyContext } from "./types";

/** Patches collected for one undo step (a single command or a whole transaction). */
interface Frame {
  label: string;
  source: DispatchSource;
  patches: Patch[];
  /** Inverse patches per update, in application order; reversed on undo/rollback. */
  inverseChunks: Patch[][];
}

export interface DispatchOptions {
  source?: DispatchSource;
}

export interface DispatchEvent {
  id: string;
  params: unknown;
  source: DispatchSource;
  result: DispatchResult;
}

export interface DispatcherDeps {
  registry: ActionRegistry;
  store: StoreApi<AppState>;
  history: History;
  services: Services;
  platform: Platform;
  /** Lazy because the keybinding service is created after (and depends on) the dispatcher. */
  getKeybindings: () => KeybindingService;
  menus: MenuRegistry;
  input: InputState;
}

export class Dispatcher {
  private frame: Frame | null = null;
  private listeners = new Set<(e: DispatchEvent) => void>();

  constructor(private readonly deps: DispatcherDeps) {}

  readonlyContext(): ReadonlyContext {
    const { store, history, platform, input } = this.deps;
    return {
      get state() {
        return store.getState();
      },
      history: {
        get canUndo() {
          return history.canUndo;
        },
        get canRedo() {
          return history.canRedo;
        },
      },
      platform,
      input,
    };
  }

  isAvailable(id: string): boolean {
    const action = this.deps.registry.get(id);
    return !!action && isAvailable(action, this.readonlyContext());
  }

  async dispatch<R = unknown>(id: string, params?: unknown, opts: DispatchOptions = {}): Promise<DispatchResult<R>> {
    const source = opts.source ?? "script";
    const result = await this.run<R>(id, params, source);
    for (const l of this.listeners) l({ id, params, source, result });
    return result;
  }

  /**
   * Run `fn` as a single undo step. Every undoable command dispatched inside
   * is merged into one history entry. If `fn` throws, all recorded changes
   * are rolled back and the error is rethrown. Nested transactions merge
   * into the outermost one.
   */
  async transaction<R>(label: string, fn: (d: Dispatcher) => Promise<R>, opts: DispatchOptions = {}): Promise<R> {
    if (this.frame) return fn(this);
    const frame: Frame = { label, source: opts.source ?? "script", patches: [], inverseChunks: [] };
    this.frame = frame;
    try {
      const value = await fn(this);
      this.commit(frame);
      return value;
    } catch (error) {
      this.rollback(frame.inverseChunks);
      throw error;
    } finally {
      this.frame = null;
    }
  }

  onDispatch(listener: (e: DispatchEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async run<R>(id: string, params: unknown, source: DispatchSource): Promise<DispatchResult<R>> {
    const action = this.deps.registry.get(id);
    if (!action) {
      return { ok: false, error: "unknown_action", message: `No action with id "${id}".` };
    }

    const rctx = this.readonlyContext();
    if (!isAvailable(action, rctx)) {
      return {
        ok: false,
        error: "unavailable",
        message: `"${action.title}" is only available when ${action.when?.describe}.`,
      };
    }

    let parsed: unknown = undefined;
    if (action.params) {
      const result = action.params.safeParse(params);
      if (!result.success) {
        return {
          ok: false,
          error: "invalid_params",
          message: `Invalid parameters for "${action.id}":\n${z.prettifyError(result.error)}`,
          issues: result.error.issues,
        };
      }
      parsed = result.data;
    } else if (!isEmptyParams(params)) {
      return { ok: false, error: "invalid_params", message: `"${action.id}" takes no parameters.` };
    }

    const recording = action.kind === "command" && !!action.undoable;
    const ownsFrame = recording && !this.frame;
    if (ownsFrame) {
      this.frame = { label: action.label?.(parsed) ?? action.title, source, patches: [], inverseChunks: [] };
    }
    const frame = recording ? this.frame : null;
    const start = frame ? { patches: frame.patches.length, chunks: frame.inverseChunks.length } : null;

    try {
      const value = (await action.run(parsed, this.createContext(source, frame))) as R;
      if (ownsFrame && frame) this.commit(frame);
      return { ok: true, value };
    } catch (error) {
      // Undo only this action's own changes, leaving any enclosing transaction intact.
      if (frame && start) {
        this.rollback(frame.inverseChunks.slice(start.chunks));
        frame.patches.length = start.patches;
        frame.inverseChunks.length = start.chunks;
      }
      return { ok: false, error: "failed", message: error instanceof Error ? error.message : String(error) };
    } finally {
      if (ownsFrame) this.frame = null;
    }
  }

  private createContext(source: DispatchSource, frame: Frame | null): AppContext {
    const { store, history, services, registry, getKeybindings, menus } = this.deps;
    const base = this.readonlyContext();
    return {
      get state() {
        return base.state;
      },
      history: base.history,
      platform: base.platform,
      input: base.input,
      menus,
      services: services as Services,
      registry,
      get keybindings() {
        return getKeybindings();
      },
      source,
      update: (recipe) => {
        const [next, patches, inverse] = produceWithPatches(store.getState(), recipe);
        if (patches.length === 0) return;
        store.setState(next, true);
        if (frame) {
          frame.patches.push(...patches);
          frame.inverseChunks.push(inverse);
        }
      },
      dispatch: (id, params) => this.dispatch(id, params, { source }),
      historyControl: { undo: () => history.undo(), redo: () => history.redo(), clear: () => history.clear() },
    };
  }

  private commit(frame: Frame): void {
    this.deps.history.push({
      label: frame.label,
      source: frame.source,
      patches: frame.patches,
      inverse: frame.inverseChunks.toReversed().flat(),
      at: Date.now(),
    });
  }

  private rollback(inverseChunks: Patch[][]): void {
    if (inverseChunks.length === 0) return;
    const { store } = this.deps;
    store.setState(applyPatches(store.getState(), inverseChunks.toReversed().flat()), true);
  }
}

export function isAvailable(action: AnyAction, ctx: ReadonlyContext): boolean {
  return !action.when || action.when.test(ctx);
}

function isEmptyParams(params: unknown): boolean {
  return (
    params === undefined ||
    params === null ||
    (typeof params === "object" && !Array.isArray(params) && Object.keys(params).length === 0)
  );
}

/** True when the action has a schema that rejects "no params" (so it needs user input). */
export function requiresParams(action: AnyAction): boolean {
  return !!action.params && !action.params.safeParse(undefined).success;
}
