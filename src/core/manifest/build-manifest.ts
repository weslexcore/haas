import { z } from "zod";
import type { ActionRegistry } from "../actions/registry";
import type { AnyAction, Category } from "../actions/types";
import { tryNormalizeChord } from "../keybindings/combo";
import type { MenuItem, MenuRegistry } from "../menus/registry";
import { APP_INFO, CONCEPTS, WORKFLOWS, type Concept, type Workflow } from "./concepts";

export const CATEGORY_ORDER: Category[] = ["App", "View", "Navigation", "Library", "Develop", "History"];

export type JSONSchema = Record<string, unknown>;

export interface ManifestAction {
  id: string;
  title: string;
  description: string;
  category: Category;
  kind: "command" | "query";
  undoable: boolean;
  /** JSON Schema (draft 2020-12) of the params object, or null when the action takes none. */
  params: JSONSchema | null;
  examples: Array<{ params: unknown; description: string }>;
  defaultShortcuts: Array<{ keys: string; params?: unknown }>;
  /** Plain-language availability condition. */
  availability: string;
}

export type ManifestMenuItem =
  | { kind: "action"; actionId: string; params?: unknown; label: string }
  | { kind: "separator" }
  | { kind: "submenu"; label: string; items: ManifestMenuItem[] };

export interface ManifestMenu {
  id: string;
  title: string;
  description: string;
  items: ManifestMenuItem[];
}

export interface Manifest {
  format: "photo-app-action-manifest";
  version: 1;
  app: typeof APP_INFO;
  conventions: string[];
  concepts: Concept[];
  workflows: Workflow[];
  actions: ManifestAction[];
  menus: ManifestMenu[];
}

export const CONVENTIONS = [
  "Every operation is an action, invoked by id with a JSON params object validated against the action's schema.",
  "Read state with query actions (kind: query) before proposing changes; they have no side effects.",
  "Respect each action's availability: dispatching an unavailable action fails.",
  "Commands marked undoable are recorded in history. A plan of several steps is applied as one transaction, so one undo reverts it.",
  "Library commands with an optional photoIds parameter act on the current selection when it is omitted.",
  "Shortcut keys use `mod` for Cmd on macOS and Ctrl elsewhere; chords are space-separated strokes.",
  "Photo ids are paths relative to the open folder, e.g. \"2026-09/DSC_0001.jpg\". Capture times are camera-local, formatted YYYY-MM-DDTHH:mm:ss without a time zone.",
  "Culling commands accept advance: true to move to the next photo afterwards; when called by an AI or script they never auto-advance otherwise.",
];

export function paramsJsonSchema(action: AnyAction): JSONSchema | null {
  if (!action.params) return null;
  const schema = z.toJSONSchema(action.params, { io: "input", unrepresentable: "any" }) as JSONSchema;
  delete schema.$schema;
  return schema;
}

export function describeAvailability(action: AnyAction): string {
  return action.when ? `Available only when ${action.when.describe}.` : "Always available.";
}

export function sortActions(actions: AnyAction[]): AnyAction[] {
  return [...actions].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.id.localeCompare(b.id),
  );
}

function menuItems(items: MenuItem[], registry: ActionRegistry): ManifestMenuItem[] {
  return items.map((item) => {
    if (item.kind === "separator") return item;
    if (item.kind === "submenu") return { kind: "submenu", label: item.label, items: menuItems(item.items, registry) };
    const action = registry.get(item.actionId);
    return {
      kind: "action",
      actionId: item.actionId,
      ...(item.params !== undefined ? { params: item.params } : {}),
      label: item.label ?? action?.label?.(item.params) ?? action?.title ?? item.actionId,
    };
  });
}

/** Workflows whose every step refers to a registered action. */
export function availableWorkflows(registry: ActionRegistry): { included: Workflow[]; skipped: Workflow[] } {
  const included: Workflow[] = [];
  const skipped: Workflow[] = [];
  for (const w of WORKFLOWS) (w.steps.every((s) => registry.get(s.actionId)) ? included : skipped).push(w);
  return { included, skipped };
}

/** Deterministic: no timestamps, stable ordering, so the committed file only changes when the registry does. */
export function buildManifest(registry: ActionRegistry, menus?: MenuRegistry): Manifest {
  return {
    format: "photo-app-action-manifest",
    version: 1,
    app: APP_INFO,
    conventions: CONVENTIONS,
    concepts: CONCEPTS,
    workflows: availableWorkflows(registry).included,
    actions: sortActions(registry.all().filter((a) => !a.internal)).map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      category: a.category,
      kind: a.kind,
      undoable: !!a.undoable,
      params: paramsJsonSchema(a),
      examples: a.examples ?? [],
      defaultShortcuts: (a.defaultShortcuts ?? []).map((s: { keys: string; params?: unknown }) => ({
        keys: tryNormalizeChord(s.keys, false) ?? s.keys,
        ...(s.params !== undefined ? { params: s.params } : {}),
      })),
      availability: describeAvailability(a),
    })),
    menus: (menus?.all() ?? []).map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      items: menuItems(m.items, registry),
    })),
  };
}

export function serializeManifest(manifest: Manifest): string {
  return JSON.stringify(manifest, null, 2) + "\n";
}
