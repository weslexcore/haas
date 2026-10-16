import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "zustand";
import { reviewStep } from "../../core/ai/plan";
import type { AiSuggestionTurn, AiTurn } from "../../core/ai/thread";
import { useAppState, useDispatch, useShortcut } from "../hooks";
import { useRuntime } from "../runtime-context";
import { Kbd } from "../shell/Kbd";
import { toast } from "../toasts";
import { aiStore, cancelThinking, review, sendToAi, type Draft } from "./ai-store";
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
 * The AI conversation: messages, every suggestion Claude made and what was
 * applied. Suggestions that haven't been applied can be reviewed, previewed
 * live on the photos, edited and applied (one undo step) at any time.
 */
export function AiPanel() {
  const runtime = useRuntime();
  const open = useAppState((s) => s.ai.panelOpen);
  const thread = useAppState((s) => s.ai.thread);
  const ui = useStore(aiStore);
  const dispatch = useDispatch("ui");
  const toggleShortcut = useShortcut("app.ai.panel.toggle");
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [thread.length, ui.thinking, open]);

  // Closing the panel ends any preview.
  useEffect(() => {
    if (!open) void review(runtime, null);
  }, [open, runtime]);

  usePreview();

  if (!open) return null;

  return (
    <aside className={styles.panel} aria-label="AI conversation">
      <header className={styles.header}>
        <span className={styles.badge}>✦ AI</span>
        <span className={styles.title}>Conversation</span>
        <button
          type="button"
          className={styles.headerButton}
          disabled={!thread.length || ui.thinking}
          onClick={() => void review(runtime, null).then(() => dispatch("app.ai.thread.clear"))}
        >
          New
        </button>
        <button type="button" className={styles.close} aria-label="Close AI panel" title={toggleShortcut ? `Close (${toggleShortcut.strokes.join(" ")})` : "Close"} onClick={() => void dispatch("app.ai.panel.toggle")}>
          ×
        </button>
      </header>

      <ol ref={listRef} className={styles.thread} aria-live="polite">
        {thread.length === 0 && !ui.thinking && (
          <li className={styles.hint}>
            Ask for culling or edits in your own words, e.g. “reject the blurry shots in this burst” or “give the selected photos a
            warm film look”. Claude can look at your photos. Suggestions stay here; nothing changes until you apply one.
            {toggleShortcut && (
              <>
                {" "}
                <Kbd strokes={toggleShortcut.strokes} /> shows or hides this panel.
              </>
            )}
          </li>
        )}
        {thread.map((turn, i) => (
          <TurnView key={turn.id} turn={turn} number={suggestionNumber(thread, i)} />
        ))}
        {ui.thinking && (
          <li className={styles.thinking} role="status">
            Claude is looking at your library and drafting a suggestion…{" "}
            <button type="button" className={styles.link} onClick={cancelThinking}>
              Stop waiting
            </button>
          </li>
        )}
      </ol>

      <Composer disabled={ui.thinking} />
    </aside>
  );
}

function suggestionNumber(thread: AiTurn[], index: number): number {
  return thread.slice(0, index + 1).filter((t) => t.role === "assistant").length;
}

function TurnView({ turn, number }: { turn: AiTurn; number: number }) {
  const dispatch = useDispatch("ui");
  if (turn.role === "user") return <li className={styles.user}>{turn.text}</li>;
  if (turn.role === "error") {
    return (
      <li className={styles.error} role="alert">
        {turn.message}
        {/API key/i.test(turn.message) && (
          <button type="button" className={styles.secondary} onClick={() => void dispatch("app.ai.settings.open")}>
            Open AI Settings
          </button>
        )}
      </li>
    );
  }
  return <SuggestionCard turn={turn} number={number} />;
}

const STATUS_LABEL = { pending: "Not applied", applied: "Applied", dismissed: "Dismissed" } as const;

function SuggestionCard({ turn, number }: { turn: AiSuggestionTurn; number: number }) {
  const runtime = useRuntime();
  const ui = useStore(aiStore);
  const dispatch = useDispatch("ui");
  const reviewing = ui.reviewing === turn.id && turn.status === "pending";
  const draft = ui.drafts[turn.id];
  const appliedIdx = new Set(turn.applied.map((a) => a.index));
  const partly = turn.status === "applied" && appliedIdx.size < turn.steps.length;

  return (
    <li className={`${styles.card} ${reviewing ? styles.reviewing : ""}`} aria-label={`Suggestion ${number}`}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>Suggestion {number}</span>
        <span className={`${styles.status} ${styles[turn.status]}`}>{partly ? "Partly applied" : STATUS_LABEL[turn.status]}</span>
      </div>
      <p className={styles.summary}>{turn.summary}</p>
      {reviewing && draft ? (
        <Review turn={turn} draft={draft} />
      ) : (
        <>
          {turn.steps.length > 0 && (
            <ul className={styles.compactSteps}>
              {turn.steps.map((s, i) => (
                <li key={i} className={appliedIdx.has(i) ? styles.appliedStep : undefined}>
                  <span aria-hidden="true">{appliedIdx.has(i) ? "✓" : "·"}</span> {s.label}
                  {s.impact && <span className={styles.impact}> {s.impact}</span>}
                  {appliedIdx.has(i) && JSON.stringify(turn.applied.find((a) => a.index === i)?.params ?? null) !== JSON.stringify(s.params ?? null) && (
                    <span className={styles.tag}>edited</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {turn.status === "pending" && turn.steps.length > 0 && (
            <div className={styles.cardActions}>
              <button type="button" className={styles.secondary} onClick={() => void dispatch("app.ai.suggestion.dismiss", { turnId: turn.id })}>
                Dismiss
              </button>
              <button type="button" className={styles.primary} onClick={() => void review(runtime, turn)}>
                Review…
              </button>
            </div>
          )}
          <div className={styles.model}>Suggested by {turn.model}</div>
        </>
      )}
    </li>
  );
}

function Review({ turn, draft }: { turn: AiSuggestionTurn; draft: Draft }) {
  const runtime = useRuntime();
  const ui = useStore(aiStore);
  const dispatch = useDispatch("ui");
  const acceptedIdx = draft.steps.map((_, i) => i).filter((i) => draft.accepted[i] && draft.steps[i]!.valid);
  const applying = useRef(false);

  const update = (patch: (d: Draft) => Draft) =>
    aiStore.setState((s) => ({ drafts: { ...s.drafts, [turn.id]: patch(s.drafts[turn.id]!) } }));

  const editParams = (i: number, text: string) => {
    const parsed = parseParams(text);
    update((d) => {
      const steps = [...d.steps];
      const paramsText = [...d.paramsText];
      paramsText[i] = text;
      if (!parsed.ok) steps[i] = { ...steps[i]!, valid: false, error: "Not valid JSON." };
      else steps[i] = reviewStep(runtime.registry, runtime.dispatcher.readonlyContext(), { ...steps[i]!, params: parsed.value });
      const accepted = [...d.accepted];
      if (!steps[i]!.valid) accepted[i] = false;
      return { ...d, steps, paramsText, accepted };
    });
  };

  const apply = async () => {
    if (applying.current) return;
    applying.current = true;
    try {
      await runtime.plans.apply(
        acceptedIdx.map((i) => ({ actionId: draft.steps[i]!.actionId, params: draft.steps[i]!.params })),
        turn.summary.length > 60 ? `${turn.summary.slice(0, 57)}…` : turn.summary,
        { turnId: turn.id, indexes: acceptedIdx },
      );
      aiStore.setState({ reviewing: null, previewErrors: {}, applyError: null });
      toast(`Applied ${acceptedIdx.length} AI-suggested change${acceptedIdx.length === 1 ? "" : "s"}. One undo reverts them all.`);
    } catch (e) {
      aiStore.setState({ applyError: e instanceof Error ? e.message : String(e) });
    } finally {
      applying.current = false;
    }
  };

  return (
    <>
      {ui.applyError && (
        <p className={styles.applyError} role="alert">
          {ui.applyError}
        </p>
      )}
      <ol className={styles.steps}>
        {draft.steps.map((step, i) => (
          <li key={i} className={`${styles.step} ${!step.valid ? styles.invalid : ""}`}>
            <label className={styles.stepHead}>
              <input
                type="checkbox"
                checked={draft.accepted[i]}
                disabled={!step.valid}
                onChange={(e) => update((d) => ({ ...d, accepted: d.accepted.map((a, k) => (k === i ? e.target.checked : a)) }))}
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
              <button type="button" className={styles.link} onClick={() => update((d) => ({ ...d, editing: d.editing.map((v, k) => (k === i ? !v : v)) }))}>
                {draft.editing[i] ? "Done" : "Edit"}
              </button>
            </div>
            {draft.editing[i] && (
              <textarea
                className={styles.params}
                aria-label={`Parameters for step ${i + 1}`}
                spellCheck={false}
                value={draft.paramsText[i]}
                onChange={(e) => editParams(i, e.target.value)}
              />
            )}
            {(step.error || ui.previewErrors[i]) && <div className={styles.stepError}>{step.error ?? ui.previewErrors[i]}</div>}
          </li>
        ))}
      </ol>
      <div className={styles.reviewFooter}>
        <label className={styles.previewToggle}>
          <input type="checkbox" checked={ui.preview} onChange={(e) => aiStore.setState({ preview: e.target.checked })} />
          Preview
        </label>
        <span className={styles.spacer} />
        <button type="button" className={styles.secondary} onClick={() => void review(runtime, null)}>
          Close
        </button>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => void review(runtime, null).then(() => dispatch("app.ai.suggestion.dismiss", { turnId: turn.id }))}
        >
          Dismiss
        </button>
        <button type="button" className={styles.primary} disabled={!acceptedIdx.length} onClick={() => void apply()}>
          {`Apply ${acceptedIdx.length}${acceptedIdx.length !== draft.steps.length ? ` of ${draft.steps.length}` : ""}`}
        </button>
      </div>
    </>
  );
}

/** Keep the live preview in step with the suggestion under review. */
function usePreview() {
  const runtime = useRuntime();
  const ui = useStore(aiStore);
  const thread = useAppState((s) => s.ai.thread);
  const turn = thread.find((t) => t.id === ui.reviewing);
  const draft = ui.reviewing ? ui.drafts[ui.reviewing] : undefined;
  const active = turn?.role === "assistant" && turn.status === "pending" && draft;
  const accepted = active ? draft.steps.map((s, i) => ({ s, i })).filter(({ s, i }) => draft.accepted[i] && s.valid) : [];
  const key = active ? JSON.stringify([ui.preview, accepted.map(({ s }) => [s.actionId, s.params])]) : "none";

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!active || !ui.preview || !accepted.some(({ s }) => s.previewable)) {
        void runtime.plans.endPreview();
        return;
      }
      void runtime.plans.preview(accepted.map(({ s }) => ({ actionId: s.actionId, params: s.params }))).then(({ failed }) => {
        aiStore.setState({ previewErrors: Object.fromEntries(failed.map((f) => [accepted[f.index]!.i, f.message])) });
      });
    }, 150);
    return () => clearTimeout(timer);
    // `key` captures what is previewed.
  }, [key, runtime]);
}

function Composer({ disabled }: { disabled: boolean }) {
  const runtime = useRuntime();
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    setText("");
    void sendToAi(runtime, t);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };
  return (
    <form
      className={styles.composer}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        className={styles.input}
        aria-label="Message the AI"
        placeholder="Ask for changes, or follow up on a suggestion…"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="submit" className={styles.primary} disabled={disabled || !text.trim()}>
        Send
      </button>
    </form>
  );
}
