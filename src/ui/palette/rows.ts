import { matchSorter, rankings, type RankingInfo } from "match-sorter";
import { isAvailable } from "../../core/actions/dispatcher";
import type { ActionRegistry } from "../../core/actions/registry";
import type { AnyAction, ReadonlyContext } from "../../core/actions/types";
import type { KeybindingService } from "../../core/keybindings/service";
import { sortActions } from "../../core/manifest/build-manifest";

export interface ActionRow {
  kind: "action";
  key: string;
  action: AnyAction;
  title: string;
  category: string;
  /** Extra text to match: param values for variant rows. */
  searchText: string;
  /** Present for variant rows that run with fixed params (from a param-carrying binding). */
  params?: unknown;
  hasFixedParams: boolean;
  strokes: string[] | null;
}

export interface AIRow {
  kind: "ai";
  key: "ai";
  prompt: string;
}

export type PaletteRow = ActionRow | AIRow;

/** Actions the palette never lists: it is already open, and AI has its own row. */
const HIDDEN = new Set(["app.palette.open", "app.palette.close", "app.ai.ask", "app.contextMenu.close"]);

export const AI_PREFIX = "?";

/**
 * One row per available command, plus a "variant" row per binding that carries
 * params (e.g. "Rate ★★★" for key 3), so common parameterized actions run in one step.
 */
export function buildRows(registry: ActionRegistry, keybindings: KeybindingService, ctx: ReadonlyContext): ActionRow[] {
  const rows: ActionRow[] = [];
  for (const action of sortActions(registry.all())) {
    if (action.kind !== "command" || action.internal || HIDDEN.has(action.id) || !isAvailable(action, ctx)) continue;
    const bindings = keybindings.bindingsFor(action.id);
    const plain = bindings.find((b) => b.params === undefined);
    rows.push({
      kind: "action",
      key: action.id,
      action,
      title: action.title,
      category: action.category,
      searchText: action.title,
      hasFixedParams: false,
      strokes: plain ? keybindings.formatStrokes(plain.keys) : null,
    });

    const seen = new Set<string>();
    for (const b of bindings) {
      if (b.params === undefined) continue;
      const paramsKey = JSON.stringify(b.params);
      if (seen.has(paramsKey)) continue;
      seen.add(paramsKey);
      const values = Object.values(b.params as Record<string, unknown>).join(" ");
      rows.push({
        kind: "action",
        key: `${action.id} ${paramsKey}`,
        action,
        title: action.label?.(b.params) ?? `${action.title}: ${values}`,
        category: action.category,
        searchText: `${action.title} ${values}`,
        params: b.params,
        hasFixedParams: true,
        strokes: keybindings.formatStrokes(b.keys),
      });
    }
  }
  return rows;
}

const KEYS = [
  "title",
  { key: "searchText", threshold: rankings.WORD_STARTS_WITH },
  { key: "category", threshold: rankings.WORD_STARTS_WITH, maxRanking: rankings.WORD_STARTS_WITH },
  { key: "action.id", threshold: rankings.CONTAINS, maxRanking: rankings.CONTAINS },
  { key: "action.description", threshold: rankings.WORD_STARTS_WITH, maxRanking: rankings.CONTAINS },
];

/**
 * Fuzzy search. Each whitespace-separated term must match (so "dev view"
 * finds "Develop View"); ties break by recency, then registry order.
 * A leading "?" switches to natural-language AI mode.
 */
export function searchRows(rows: ActionRow[], query: string, recents: readonly string[]): PaletteRow[] {
  const q = query.trim();
  if (q.startsWith(AI_PREFIX)) return [{ kind: "ai", key: "ai", prompt: q.slice(AI_PREFIX.length).trim() }];

  const recency = (row: ActionRow) => {
    const i = recents.indexOf(row.key);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  if (!q) {
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => recency(a.row) - recency(b.row) || a.index - b.index)
      .map((x) => x.row);
  }

  const baseSort = (a: RankingInfo & { item: ActionRow; index: number }, b: RankingInfo & { item: ActionRow; index: number }) =>
    recency(a.item) - recency(b.item) || a.index - b.index;
  const matched = q
    .split(/\s+/)
    .reduceRight<ActionRow[]>((acc, term) => matchSorter(acc, term, { keys: KEYS, baseSort }), rows);
  return [...matched, { kind: "ai", key: "ai", prompt: q }];
}
