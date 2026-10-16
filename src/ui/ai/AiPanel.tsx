import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { reviewStep } from "../../core/ai/plan";
import { useRuntime } from "../runtime-context";
import { toast } from "../toasts";
import { aiStore, closeAi, type DraftStep } from "./ai-store";
import styles from "./AiPanel.module.css";

function parseParams(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const v = JSON.parse(text || "{}") as unknown;
    return { ok: true, value: v && typeof v === "object" && Object.keys(v).length === 0 ? undefined : v };
  } catch {
    return { ok: false };
  }
}

/**
 * Review an AI plan: every step is checked against its action's schema, can be
 * switched off or have its params edited, and (where possible) is previewed
 * live on the photos before anything is applied. Applying runs the accepted
 * steps as one undoable transaction.
 */
export function AiPanel() {
  const runtime = useRuntime();
  const session = useStore(aiStore);
  const { status, steps, preview } = session;

  const accepted = steps.filter((s) => s.accepted && s.valid);
  const previewKey = JSON.stringify(accepted.map((s) => [s.actionId, s.params]));

  // Keep the live preview in step with the accepted steps.
  useEffect(() => {
    if (status !== "review") return;
    const timer = setTimeout(() => {
      if (!preview || !accepted.some((s) => s.previewable)) {
        void runtime.plans.endPreview();
        aiStore.setState({ previewErrors: {} });
        return;
      }
      void runtime.plans.preview(accepted.map(({ actionId, params }) => ({ actionId, params }))).then(({ failed }) => {
        const indexes = accepted.map((s) => steps.indexOf(s));
        aiStore.setState({ previewErrors: Object.fromEntries(failed.map((f) => [indexes[f.index]!, f.message])) });
      });
    }, 150);
    return () => clearTimeout(timer);
    // previewKey captures the accepted steps' content.
  }, [status, preview, previewKey, runtime]);

  // Escape cancels (when focus isn't in a text field).
  useEffect(() => {
    if (status === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLTextAreaElement)) void closeAi(runtime);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, runtime]);

  const counts = useMemo(() => ({ total: steps.length, accepted: accepted.length }), [steps, accepted.length]);
  if (status === "idle") return null;

  const update = (index: number, patch: Partial<DraftStep>) => {
    aiStore.setState((s) => ({ steps: s.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)) }));
  };

  const editParams = (index: number, text: string) => {
    const step = steps[index]!;
    const parsed = parseParams(text);
    if (!parsed.ok) return update(index, { paramsText: text, valid: false, error: "Not valid JSON." });
    const reviewed = reviewStep(runtime.registry, runtime.dispatcher.readonlyContext(), { actionId: step.actionId, params: parsed.value, reason: step.reason });
    update(index, { ...reviewed, paramsText: text, accepted: step.accepted && reviewed.valid });
  };

  const apply = async () => {
    aiStore.setState({ status: "applying" });
    try {
      await runtime.plans.apply(
        accepted.map(({ actionId, params }) => ({ actionId, params })),
        session.summary.length > 60 ? `${session.summary.slice(0, 57)}…` : session.summary || session.prompt,
      );
      toast(`Applied ${accepted.length} AI-proposed change${accepted.length === 1 ? "" : "s"}. One undo reverts them all.`);
      aiStore.setState({ status: "idle", steps: [] });
    } catch (e) {
      aiStore.setState({ status: "review", error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <aside className={styles.panel} aria-label="AI plan" role="complementary">
      <header className={styles.header}>
        <span className={styles.badge}>✦ AI</span>
        <span className={styles.title}>{status === "thinking" ? "Planning…" : "Proposed changes"}</span>
        <button type="button" className={styles.close} aria-label="Close AI plan" onClick={() => void closeAi(runtime)}>
          ×
        </button>
      </header>
      <blockquote className={styles.prompt}>“{session.prompt}”</blockquote>

      {status === "thinking" && (
        <p className={styles.thinking} role="status">
          Claude is reading your library and drafting a plan…
        </p>
      )}

      {status === "error" && (
        <div className={styles.errorBox} role="alert">
          <p>{session.error}</p>
          {/API key/i.test(session.error ?? "") && (
            <button type="button" className={styles.secondary} onClick={() => void runtime.dispatch("app.ai.settings.open", undefined, { source: "ui" })}>
              Open AI Settings
            </button>
          )}
        </div>
      )}

      {(status === "review" || status === "applying") && (
        <>
          <p className={styles.summary}>{session.summary}</p>
          {session.error && (
            <p className={styles.applyError} role="alert">
              {session.error}
            </p>
          )}
          {steps.length === 0 ? (
            <p className={styles.empty}>No changes proposed.</p>
          ) : (
            <ol className={styles.steps}>
              {steps.map((step, i) => (
                <li key={i} className={`${styles.step} ${!step.valid ? styles.invalid : ""}`}>
                  <label className={styles.stepHead}>
                    <input
                      type="checkbox"
                      checked={step.accepted}
                      disabled={!step.valid}
                      onChange={(e) => update(i, { accepted: e.target.checked })}
                    />
                    <span className={styles.stepLabel}>
                      {step.label}
                      {step.impact && <span className={styles.impact}> {step.impact}</span>}
                    </span>
                  </label>
                  <div className={styles.reason}>{step.reason}</div>
                  <div className={styles.meta}>
                    <code>{step.actionId}</code>
                    {step.valid && !step.previewable && <span className={styles.tag}>applies on Apply</span>}
                    <button type="button" className={styles.link} onClick={() => update(i, { editing: !step.editing })}>
                      {step.editing ? "Done" : "Edit"}
                    </button>
                  </div>
                  {step.editing && (
                    <textarea
                      className={styles.params}
                      aria-label={`Parameters for step ${i + 1}`}
                      spellCheck={false}
                      value={step.paramsText}
                      onChange={(e) => editParams(i, e.target.value)}
                    />
                  )}
                  {(step.error || session.previewErrors[i]) && (
                    <div className={styles.stepError}>{step.error ?? session.previewErrors[i]}</div>
                  )}
                </li>
              ))}
            </ol>
          )}
          <footer className={styles.footer}>
            <label className={styles.previewToggle}>
              <input type="checkbox" checked={preview} onChange={(e) => aiStore.setState({ preview: e.target.checked })} />
              Preview
            </label>
            <span className={styles.model}>Proposed by {session.model}</span>
            <button type="button" className={styles.secondary} onClick={() => void closeAi(runtime)}>
              Cancel
            </button>
            <button type="button" className={styles.primary} disabled={!counts.accepted || status === "applying"} onClick={() => void apply()}>
              {status === "applying" ? "Applying…" : `Apply ${counts.accepted}${counts.total !== counts.accepted ? ` of ${counts.total}` : ""}`}
            </button>
          </footer>
        </>
      )}
    </aside>
  );
}
