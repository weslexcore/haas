import type { ActionRegistry } from "../actions/registry";
import type { AnyAction, ReadonlyContext } from "../actions/types";
import { isAvailable } from "../actions/dispatcher";

export interface PlanStepInput {
  actionId: string;
  params: unknown;
  reason: string;
}

export interface ReviewedStep extends PlanStepInput {
  valid: boolean;
  /** Why the step can't run as proposed. */
  error?: string;
  /** Human label, e.g. "Rate ★★★". */
  label: string;
  /** What it touches, e.g. "on 12 photos". */
  impact?: string;
  /** Can be shown as a live preview before applying (pure state changes only). */
  previewable: boolean;
}

/** Actions an AI plan may never contain (they manage the AI itself or are plumbing). */
const FORBIDDEN_PREFIXES = ["app.ai.", "app.account.", "app.shortcuts.", "app.palette.", "app.contextMenu.", "history."];

const PREVIEW_CATEGORIES = new Set(["Library", "Develop", "View", "Navigation"]);

export function isPreviewable(action: AnyAction): boolean {
  return action.kind === "command" && PREVIEW_CATEGORIES.has(action.category) && !action.sideEffects;
}

function impactOf(action: AnyAction, params: unknown, ctx: ReadonlyContext): string {
  const ids = (params as { photoIds?: unknown } | undefined)?.photoIds;
  const n = action.targets ? action.targets(params, ctx).length : Array.isArray(ids) ? ids.length : ctx.state.selection.ids.length;
  return n === 1 ? "on 1 photo" : `on ${n} photos`;
}

/** Check one proposed step against the registry, its schema and the current context. */
export function reviewStep(registry: ActionRegistry, ctx: ReadonlyContext, step: PlanStepInput): ReviewedStep {
  const action = registry.get(step.actionId);
  const base = { ...step, label: step.actionId, previewable: false };
  if (!action) return { ...base, valid: false, error: `There is no action "${step.actionId}".` };
  if (action.internal || FORBIDDEN_PREFIXES.some((p) => action.id.startsWith(p))) {
    return { ...base, label: action.title, valid: false, error: "AI plans can't use this action." };
  }
  if (action.kind === "query") {
    return { ...base, label: action.title, valid: false, error: "This only reads information; it changes nothing." };
  }
  let parsed: unknown = undefined;
  if (action.params) {
    const r = action.params.safeParse(step.params);
    if (!r.success) {
      return { ...base, label: action.title, valid: false, error: r.error.issues.map((i) => `${i.path.join(".") || "params"}: ${i.message}`).join("; ") };
    }
    parsed = r.data;
  }
  const label = action.label?.(parsed as never) ?? action.title;
  const touchesPhotos = action.category === "Library" || action.category === "Develop";
  const usesSelection = touchesPhotos && (action.undoable || !!action.targets);
  return {
    ...base,
    params: step.params,
    label,
    ...(usesSelection ? { impact: impactOf(action, parsed, ctx) } : {}),
    previewable: isPreviewable(action),
    valid: true,
    ...(!isAvailable(action, ctx) && !touchesPhotos ? { error: `Only available when ${action.when?.describe}.` } : {}),
  };
}

export function reviewPlan(registry: ActionRegistry, ctx: ReadonlyContext, steps: PlanStepInput[]): ReviewedStep[] {
  return steps.map((s) => reviewStep(registry, ctx, s));
}
