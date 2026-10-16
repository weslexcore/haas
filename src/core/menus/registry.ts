/**
 * Context menus are data: lists of action references. Labels, availability
 * and shortcuts come from the action registry, so menus never drift from the
 * actions they run.
 */

export type MenuItem =
  | { kind: "action"; actionId: string; params?: unknown; label?: string }
  | { kind: "separator" }
  | { kind: "submenu"; label: string; items: MenuItem[] };

export interface MenuDefinition {
  /** Namespaced id, e.g. "grid.photo". */
  id: string;
  title: string;
  /** Where the menu appears, for docs and AI. */
  description: string;
  items: MenuItem[];
}

export const item = (actionId: string, params?: unknown, label?: string): MenuItem => ({
  kind: "action",
  actionId,
  ...(params !== undefined ? { params } : {}),
  ...(label !== undefined ? { label } : {}),
});

export const separator: MenuItem = { kind: "separator" };

export const submenu = (label: string, items: MenuItem[]): MenuItem => ({ kind: "submenu", label, items });

/** One item per value of a single param, e.g. ratings 0–5. */
export const choices = <T>(actionId: string, key: string, values: readonly T[]): MenuItem[] =>
  values.map((v) => item(actionId, { [key]: v }));

export class MenuRegistry {
  private readonly menus = new Map<string, MenuDefinition>();

  register(menu: MenuDefinition): void {
    if (this.menus.has(menu.id)) throw new Error(`Duplicate menu id "${menu.id}".`);
    this.menus.set(menu.id, menu);
  }

  registerAll(menus: readonly MenuDefinition[]): this {
    for (const m of menus) this.register(m);
    return this;
  }

  get(id: string): MenuDefinition | undefined {
    return this.menus.get(id);
  }

  all(): MenuDefinition[] {
    return [...this.menus.values()];
  }
}

/** Depth-first list of every action item in a menu. */
export function menuActionItems(items: MenuItem[]): Array<Extract<MenuItem, { kind: "action" }>> {
  return items.flatMap((i) => (i.kind === "action" ? [i] : i.kind === "submenu" ? menuActionItems(i.items) : []));
}
