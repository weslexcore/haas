import type { z } from "zod";
import type { AppState } from "../state/types";
import type { Services } from "../services";
import type { WhenClause } from "./when";
import type { ActionRegistry } from "./registry";
import type { KeybindingService } from "../keybindings/service";
import type { MenuRegistry } from "../menus/registry";
import type { HistoryEffect } from "../history/history";

export type Category = "App" | "View" | "Navigation" | "Library" | "Develop" | "History";

export type DispatchSource = "keyboard" | "palette" | "menu" | "ui" | "ai" | "script";

/** Sources where a person is directly at the controls (as opposed to AI or scripts). */
export const INTERACTIVE_SOURCES: readonly DispatchSource[] = ["keyboard", "palette", "menu", "ui"];

/** Live input state, updated by the UI from keyboard and mouse events. */
export interface InputState {
  readonly capsLock: boolean;
}

export interface ShortcutBinding<P = unknown> {
  /** Space-separated chord of strokes, e.g. "mod+k", "shift+x", "t t". */
  keys: string;
  /** Fixed params dispatched with this binding, e.g. { rating: 3 } for key "3". */
  params?: P;
  /** Fire even while focus is in a text field. */
  allowInInput?: boolean;
}

/** What `when` clauses and queries may read. */
export interface ReadonlyContext {
  readonly state: AppState;
  readonly history: { readonly canUndo: boolean; readonly canRedo: boolean };
  readonly platform: Platform;
  readonly input: InputState;
}

export interface Platform {
  readonly isMac: boolean;
  /** Whether the OS currently prefers a dark colour scheme. */
  prefersDark(): boolean;
}

export interface AppContext extends ReadonlyContext {
  /**
   * Change state with an Immer recipe. For undoable commands the change is
   * recorded in history; otherwise it is applied without an undo entry.
   */
  update(recipe: (draft: AppState) => void): void;
  readonly services: Services;
  /** Read-only access to action definitions, for introspection actions (manifest, action list). */
  readonly registry: ActionRegistry;
  /** Keyboard shortcut bindings, for the shortcut-management actions. */
  readonly keybindings: KeybindingService;
  /** Context menu definitions. */
  readonly menus: MenuRegistry;
  readonly source: DispatchSource;
  dispatch<R = unknown>(id: string, params?: unknown): Promise<DispatchResult<R>>;
  /**
   * Undoable commands only: register a side effect outside app state (such as
   * moving files) that undo/redo must reverse along with the state changes.
   */
  recordEffect(effect: HistoryEffect): void;
  /** Undo / redo / clear, for history actions and folder loading only. */
  readonly historyControl: { undo(): Promise<boolean>; redo(): Promise<boolean>; clear(): void };
}

export interface ActionDefinition<P = void, R = unknown> {
  /** Stable, namespaced ID: "library.rating.set". */
  id: string;
  /** Short human label shown in the palette: "Set Rating". */
  title: string;
  /** AI-readable explanation of what it does and when to use it. */
  description: string;
  category: Category;
  /** Queries read state with no side effects; commands change state. */
  kind: "command" | "query";
  params?: z.ZodType<P>;
  // NoInfer: P is inferred from `params` only, never widened by literals in examples/shortcuts.
  examples?: Array<{ params: NoInfer<P>; description: string }>;
  defaultShortcuts?: Array<ShortcutBinding<NoInfer<P>>>;
  when?: WhenClause;
  undoable?: boolean;
  /**
   * Plumbing used by the app itself (e.g. background indexing results).
   * Validated and dispatched like any action, but hidden from the palette,
   * shortcuts screen and manifest.
   */
  internal?: boolean;
  /**
   * Undoable commands: consecutive runs with the same key (within ~1.5s) merge
   * into one undo step, e.g. every frame of a slider drag.
   */
  coalesce?: (params: NoInfer<P>) => string;
  /** Human label for a specific invocation, used in the palette, history and plan review. */
  label?: (params: NoInfer<P>) => string;
  run(params: NoInfer<P>, ctx: AppContext): R | Promise<R>;
}

export type AnyAction = ActionDefinition<any, any>;

export type DispatchErrorCode = "unknown_action" | "unavailable" | "invalid_params" | "failed";

export type DispatchResult<R = unknown> =
  | { ok: true; value: R }
  | {
      ok: false;
      error: DispatchErrorCode;
      message: string;
      issues?: z.core.$ZodIssue[];
    };

/** Identity helper that gives full type inference for an action definition. */
export function defineAction<P = void, R = unknown>(def: ActionDefinition<P, R>): ActionDefinition<P, R> {
  return def;
}
