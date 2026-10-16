import { createStore } from "zustand/vanilla";
import { reviewStep, type ReviewedStep } from "../../core/ai/plan";
import type { AiSuggestionTurn } from "../../core/ai/thread";
import type { Runtime } from "../../core/runtime";

/** Review state for one suggestion card. UI session state, not app state. */
export interface Draft {
  steps: ReviewedStep[];
  accepted: boolean[];
  paramsText: string[];
  editing: boolean[];
}

export interface AiUiState {
  thinking: boolean;
  /** The suggestion being reviewed (and previewed). */
  reviewing: string | null;
  drafts: Record<string, Draft>;
  preview: boolean;
  previewErrors: Record<number, string>;
  applyError: string | null;
}

export const aiStore = createStore<AiUiState>()(() => ({
  thinking: false,
  reviewing: null,
  drafts: {},
  preview: true,
  previewErrors: {},
  applyError: null,
}));

let requestId = 0;

/** A fresh draft, re-checked against the current state (photos or settings may have changed since). */
export function newDraft(runtime: Runtime, turn: AiSuggestionTurn): Draft {
  const ctx = runtime.dispatcher.readonlyContext();
  const steps = turn.steps.map((s) => reviewStep(runtime.registry, ctx, s));
  return {
    steps,
    accepted: steps.map((s) => s.valid && !s.error),
    paramsText: steps.map((s) => (s.params === undefined ? "{}" : JSON.stringify(s.params, null, 2))),
    editing: steps.map(() => false),
  };
}

export async function review(runtime: Runtime, turn: AiSuggestionTurn | null): Promise<void> {
  if (!turn) {
    await runtime.plans.endPreview();
    aiStore.setState({ reviewing: null, previewErrors: {}, applyError: null });
    return;
  }
  const drafts = aiStore.getState().drafts;
  aiStore.setState({
    reviewing: turn.id,
    drafts: drafts[turn.id] ? drafts : { ...drafts, [turn.id]: newDraft(runtime, turn) },
    previewErrors: {},
    applyError: null,
  });
}

/** Send a message in the conversation. The reply appears in the thread; the newest suggestion opens for review. */
export async function sendToAi(runtime: Runtime, text: string): Promise<void> {
  const id = ++requestId;
  await review(runtime, null);
  if (!runtime.store.getState().ai.panelOpen) await runtime.dispatch("app.ai.panel.toggle", undefined, { source: "ui" });
  aiStore.setState({ thinking: true });
  const r = await runtime.dispatch<{ turnId: string }>("app.ai.ask", { prompt: text }, { source: "palette" });
  if (id !== requestId) return;
  aiStore.setState({ thinking: false });
  if (!r.ok) return; // the error is shown in the thread
  const turn = runtime.store.getState().ai.thread.find((t) => t.id === r.value.turnId);
  if (turn?.role === "assistant" && turn.steps.length) await review(runtime, turn);
}

export function cancelThinking(): void {
  requestId++;
  aiStore.setState({ thinking: false });
}
