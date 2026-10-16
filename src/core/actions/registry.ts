import type { AnyAction } from "./types";

export const ACTION_ID_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

export class ActionRegistry {
  private readonly actions = new Map<string, AnyAction>();

  register(action: AnyAction): void {
    if (!ACTION_ID_PATTERN.test(action.id)) {
      throw new Error(`Invalid action id "${action.id}": use namespaced camelCase like "library.rating.set".`);
    }
    if (this.actions.has(action.id)) {
      throw new Error(`Duplicate action id "${action.id}".`);
    }
    if (action.kind === "query" && action.undoable) {
      throw new Error(`Query action "${action.id}" cannot be undoable.`);
    }
    this.actions.set(action.id, action);
  }

  registerAll(actions: readonly AnyAction[]): this {
    for (const action of actions) this.register(action);
    return this;
  }

  get(id: string): AnyAction | undefined {
    return this.actions.get(id);
  }

  all(): AnyAction[] {
    return [...this.actions.values()];
  }
}
