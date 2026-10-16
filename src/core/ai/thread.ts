import type { ReviewedStep } from "./plan";

/**
 * The AI conversation: user messages and the plans Claude suggested, with
 * what the user did with each suggestion. Lives in app state (so applying a
 * suggestion and marking it applied are one undoable step) and is saved per
 * folder.
 *
 * For the model, earlier turns are replayed verbatim (`sent` / `reply`), so
 * the prompt prefix stays stable for caching; the current status of every
 * suggestion is reported in each new message instead.
 */

export interface AiUserTurn {
  id: string;
  role: "user";
  text: string;
  /** The exact message sent to the model (request + context + status). */
  sent: string;
  at: number;
}

export interface AiSuggestionTurn {
  id: string;
  role: "assistant";
  model: string;
  summary: string;
  steps: ReviewedStep[];
  /** The exact reply text replayed to the model in later turns. */
  reply: string;
  status: "pending" | "applied" | "dismissed";
  /** Steps that were applied, with the params actually used (the user may have edited them). */
  applied: Array<{ index: number; params: unknown }>;
  at: number;
}

export interface AiErrorTurn {
  id: string;
  role: "error";
  message: string;
  at: number;
}

export type AiTurn = AiUserTurn | AiSuggestionTurn | AiErrorTurn;

let seq = 0;
export const turnId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

export const suggestions = (thread: AiTurn[]) => thread.filter((t): t is AiSuggestionTurn => t.role === "assistant");

/** The model-facing text of a suggestion, in the same shape as its structured output. */
export function renderReply(summary: string, steps: Array<{ actionId: string; params: unknown; reason: string }>): string {
  return JSON.stringify({
    summary,
    steps: steps.map((s) => ({ actionId: s.actionId, paramsJson: JSON.stringify(s.params ?? {}), reason: s.reason })),
  });
}

/** Earlier exchanges to replay: only user turns that got a suggestion back. */
export function historyMessages(thread: AiTurn[]): Array<{ role: "user" | "assistant"; text: string }> {
  const out: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (let i = 0; i < thread.length; i++) {
    const turn = thread[i]!;
    const next = thread[i + 1];
    if (turn.role === "user" && next?.role === "assistant") {
      out.push({ role: "user", text: turn.sent }, { role: "assistant", text: next.reply });
    }
  }
  return out;
}

/** What happened to each earlier suggestion, for the next message. */
export function suggestionStatus(thread: AiTurn[]): string | null {
  const all = suggestions(thread);
  if (!all.length) return null;
  const lines = all.map((s, n) => {
    const head = `Suggestion ${n + 1} ("${s.summary.slice(0, 80)}")`;
    if (s.status === "dismissed") return `${head}: dismissed by the user; nothing applied.`;
    if (!s.steps.length) return `${head}: no steps.`;
    if (s.status === "pending") return `${head}: not applied (the user hasn't applied it, or undid it).`;
    const appliedIdx = new Set(s.applied.map((a) => a.index));
    const parts = [`applied steps ${[...appliedIdx].map((i) => i + 1).join(", ")}`];
    const skipped = s.steps.map((_, i) => i).filter((i) => !appliedIdx.has(i));
    if (skipped.length) parts.push(`not applied: steps ${skipped.map((i) => i + 1).join(", ")}`);
    for (const a of s.applied) {
      if (JSON.stringify(a.params ?? null) !== JSON.stringify(s.steps[a.index]?.params ?? null)) {
        parts.push(`step ${a.index + 1} was edited by the user and applied with params ${JSON.stringify(a.params ?? {})}`);
      }
    }
    return `${head}: ${parts.join("; ")}.`;
  });
  return lines.join("\n");
}

/** Compose the next user message: request, fresh context and suggestion status. */
export function composeMessage(text: string, context: unknown, thread: AiTurn[]): string {
  const status = suggestionStatus(thread);
  return [
    `<app_context>\n${JSON.stringify(context, null, 2)}\n</app_context>`,
    status ? `<suggestion_status>\n${status}\n</suggestion_status>` : null,
    `<request>\n${text}\n</request>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
