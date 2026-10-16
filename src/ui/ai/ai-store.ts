import { createStore } from "zustand/vanilla";
import type { ReviewedStep } from "../../core/ai/plan";
import type { Runtime } from "../../core/runtime";

export interface DraftStep extends ReviewedStep {
  accepted: boolean;
  /** Params as editable JSON. */
  paramsText: string;
  editing: boolean;
}

export interface AiSession {
  status: "idle" | "thinking" | "review" | "applying" | "error";
  prompt: string;
  summary: string;
  model: string;
  steps: DraftStep[];
  error: string | null;
  preview: boolean;
  /** Steps whose preview failed (index → message). */
  previewErrors: Record<number, string>;
}

const idle: AiSession = { status: "idle", prompt: "", summary: "", model: "", steps: [], error: null, preview: true, previewErrors: {} };

/** The current AI request and its plan under review. UI session state, not app state. */
export const aiStore = createStore<AiSession>()(() => idle);

let requestId = 0;

/** Ask for a plan. Results of a superseded or cancelled request are ignored. */
export async function askAi(runtime: Runtime, prompt: string): Promise<void> {
  const id = ++requestId;
  await runtime.plans.endPreview();
  aiStore.setState({ ...idle, status: "thinking", prompt });
  const r = await runtime.dispatch<{ summary: string; model: string; steps: ReviewedStep[] }>("app.ai.ask", { prompt }, { source: "palette" });
  if (id !== requestId) return;
  if (!r.ok) {
    aiStore.setState({ status: "error", error: r.message });
    return;
  }
  aiStore.setState({
    status: "review",
    summary: r.value.summary,
    model: r.value.model,
    steps: r.value.steps.map((s) => ({
      ...s,
      accepted: s.valid && !s.error,
      paramsText: s.params === undefined ? "{}" : JSON.stringify(s.params, null, 2),
      editing: false,
    })),
  });
}

export async function closeAi(runtime: Runtime): Promise<void> {
  requestId++;
  await runtime.plans.endPreview();
  aiStore.setState(idle);
}
