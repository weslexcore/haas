import type { Dispatcher } from "../actions/dispatcher";
import type { ActionRegistry } from "../actions/registry";
import type { History } from "../history/history";
import type { AppStore } from "../state/store";
import type { AppState } from "../state/types";
import { isPreviewable } from "./plan";

export interface PlanStepToRun {
  actionId: string;
  params: unknown;
}

/**
 * Previews and applies AI plans.
 *
 * Preview: snapshot the state, run the previewable steps with history
 * recording suspended, and let the UI show the result for real. Nothing is
 * persisted (MetadataSync ignores previews) and other edits are refused until
 * the preview ends. Ending restores the snapshot exactly.
 *
 * Apply: end any preview, then run the steps through the normal dispatcher as
 * one transaction, so one undo reverts the whole plan. If any step fails, all
 * of it is rolled back.
 */
export class PlanRunner {
  private snapshot: AppState | null = null;
  private previewQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: AppStore,
    private readonly history: History,
    private readonly dispatcher: Dispatcher,
    private readonly registry: ActionRegistry,
  ) {
    dispatcher.addGuard((action, source) => {
      if (!this.snapshot || source === "ai") return null;
      const blocked = action.kind === "command" && (action.undoable || action.sideEffects || action.category === "Develop" || action.category === "Library");
      return blocked && !action.id.startsWith("library.selection") ? "Apply or cancel the AI plan first." : null;
    });
  }

  get previewing(): boolean {
    return this.snapshot !== null;
  }

  /** Replace the current preview with these steps (non-previewable ones are skipped). */
  preview(steps: PlanStepToRun[]): Promise<{ failed: Array<{ index: number; message: string }> }> {
    const run = async () => {
      this.restore();
      this.snapshot = this.store.getState();
      this.store.setState({ ai: { ...this.snapshot.ai, previewing: true } });
      const failed: Array<{ index: number; message: string }> = [];
      await this.history.withoutRecording(async () => {
        for (const [index, step] of steps.entries()) {
          const action = this.registry.get(step.actionId);
          if (!action || !isPreviewable(action)) continue;
          const r = await this.dispatcher.dispatch(step.actionId, step.params, { source: "ai" });
          if (!r.ok) failed.push({ index, message: r.message });
        }
      });
      return { failed };
    };
    const result = this.previewQueue.then(run, run);
    this.previewQueue = result.catch(() => undefined);
    return result;
  }

  /** Discard the preview, restoring the state from before it. */
  endPreview(): Promise<void> {
    const run = async () => this.restore();
    const result = this.previewQueue.then(run, run);
    this.previewQueue = result.catch(() => undefined);
    return result;
  }

  async apply(steps: PlanStepToRun[], label: string): Promise<void> {
    await this.endPreview();
    await this.dispatcher.transaction(
      `AI: ${label}`,
      async (d) => {
        for (const [i, step] of steps.entries()) {
          const r = await d.dispatch(step.actionId, step.params, { source: "ai" });
          if (!r.ok) throw new Error(`Step ${i + 1} (${this.registry.get(step.actionId)?.title ?? step.actionId}) failed: ${r.message}`);
        }
      },
      { source: "ai" },
    );
  }

  private restore(): void {
    if (!this.snapshot) return;
    const snapshot = this.snapshot;
    this.snapshot = null;
    this.store.setState({ ...snapshot, ai: { ...snapshot.ai, previewing: false } }, true);
  }
}
