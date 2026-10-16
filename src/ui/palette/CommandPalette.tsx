import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { requiresParams } from "../../core/actions/dispatcher";
import { sendToAi } from "../ai/ai-store";
import { useAppState, useBindingsVersion } from "../hooks";
import { useRuntime } from "../runtime-context";
import { Kbd } from "../shell/Kbd";
import { Modal } from "../shell/Modal";
import { toast } from "../toasts";
import { ParamForm } from "./ParamForm";
import { paramsJsonSchema } from "../../core/manifest/build-manifest";
import { shouldAskForParams } from "./schema-form";
import { getRecents, pushRecent } from "./recents";
import { AI_PREFIX, buildRows, searchRows, type ActionRow, type PaletteRow } from "./rows";
import styles from "./CommandPalette.module.css";

type Step = { kind: "search" } | { kind: "params"; row: ActionRow };

export function CommandPalette() {
  const palette = useAppState((s) => s.palette);
  if (!palette.open) return null;
  return <PaletteDialog key={palette.actionId ?? ""} initialActionId={palette.actionId} />;
}

function PaletteDialog({ initialActionId }: { initialActionId: string | null }) {
  const runtime = useRuntime();
  const { registry, keybindings, dispatcher, services } = runtime;
  const state = useAppState((s) => s);
  const bindingsVersion = useBindingsVersion();

  const rows = useMemo(
    () => buildRows(registry, keybindings, dispatcher.readonlyContext()),
    // `state` and `bindingsVersion` are deliberate deps: availability and shortcuts change with them.
    [registry, keybindings, dispatcher, state, bindingsVersion],
  );

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [step, setStep] = useState<Step>(() => {
    const row = initialActionId ? rows.find((r) => r.key === initialActionId) : undefined;
    return row?.action.params ? { kind: "params", row } : { kind: "search" };
  });
  const results = useMemo(() => searchRows(rows, query, getRecents()), [rows, query]);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const close = () => void runtime.dispatch("app.palette.close", undefined, { source: "palette" });

  async function run(row: ActionRow, params: unknown) {
    pushRecent(services.settings, row.key);
    await runtime.dispatch("app.palette.close", undefined, { source: "palette" });
    const result = await runtime.dispatch(row.action.id, params, { source: "palette" });
    if (!result.ok) toast(result.message, "error");
  }

  async function askAI(prompt: string) {
    if (!prompt) return;
    // The plan is reviewed in the AI panel, which stays open beside the photos for previewing.
    await runtime.dispatch("app.palette.close", undefined, { source: "palette" });
    void sendToAi(runtime, prompt);
  }

  function choose(row: PaletteRow | undefined) {
    if (!row) return;
    if (row.kind === "ai") void askAI(row.prompt);
    else if (!row.hasFixedParams && shouldAskForParams(paramsJsonSchema(row.action), !requiresParams(row.action))) {
      setStep({ kind: "params", row });
    } else void run(row, row.params);
  }

  function onEscape() {
    if (step.kind !== "search" && !initialActionId) setStep({ kind: "search" });
    else close();
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const count = results.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % count);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + count) % count);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    }
  }

  return (
    <Modal label="Command palette" onEscape={onEscape} onBackdropClick={close} className={styles.palette}>
      {step.kind === "search" && (
        <>
          <input
            data-autofocus
            className={styles.search}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results.length ? `palette-option-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="Search actions"
            placeholder={`Search actions, or type ${AI_PREFIX} to ask AI`}
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
          />
          <ul ref={listRef} id="palette-results" role="listbox" aria-label="Actions" className={styles.results}>
            {results.map((row, i) => (
              <li
                key={row.key}
                id={`palette-option-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                className={styles.row}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => choose(row)}
              >
                {row.kind === "ai" ? (
                  <>
                    <span className={styles.aiMark} aria-hidden="true">
                      ✦
                    </span>
                    <span className={styles.rowTitle}>
                      Ask AI{row.prompt ? `: “${row.prompt}”` : "… (type a request after ?)"}
                    </span>
                    <span className={styles.category}>AI</span>
                  </>
                ) : (
                  <>
                    <span className={styles.rowTitle}>
                      {row.title}
                      {!row.hasFixedParams && requiresParams(row.action) && <span className={styles.ellipsis}>…</span>}
                      {!query && getRecents().includes(row.key) && <span className={styles.recent}>recent</span>}
                    </span>
                    <span className={styles.category}>{row.category}</span>
                    {row.strokes && <Kbd strokes={row.strokes} />}
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="visually-hidden" aria-live="polite">
            {results.length} results
          </div>
          <div className={styles.footer}>
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> navigate
            </span>
            <span>
              <kbd>↩</kbd> run
            </span>
            <span>
              <kbd>Esc</kbd> close
            </span>
            <span>
              <kbd>{AI_PREFIX}</kbd> ask AI
            </span>
          </div>
        </>
      )}

      {step.kind === "params" && (
        <ParamForm
          action={step.row.action}
          onSubmit={(params) => void run(step.row, params)}
          onBack={onEscape}
        />
      )}

    </Modal>
  );
}
