import { useMemo, useRef, useState } from "react";
import type { AnyAction } from "../../core/actions/types";
import type { ResolvedBinding } from "../../core/keybindings/service";
import { CATEGORY_ORDER, describeAvailability, sortActions } from "../../core/manifest/build-manifest";
import { useAppState, useBindingsVersion, useDispatch } from "../hooks";
import { useRuntime } from "../runtime-context";
import { Icon } from "../shell/Icon";
import { Kbd } from "../shell/Kbd";
import { Modal } from "../shell/Modal";
import { toast } from "../toasts";
import { KeyRecorder } from "./KeyRecorder";
import styles from "./ShortcutsSettings.module.css";

export function ShortcutsSettings() {
  const open = useAppState((s) => s.shortcutsOpen);
  return open ? <ShortcutsDialog /> : null;
}

type Recording = { actionId: string; index: number | null };

function ShortcutsDialog() {
  const { registry, keybindings } = useRuntime();
  const version = useBindingsVersion();
  const dispatch = useDispatch("ui");
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<Recording | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // `version` is a deliberate dep: bindings and conflicts change with it.
  const conflicts = useMemo(() => keybindings.conflicts(), [keybindings, version]);
  const conflictKeys = useMemo(() => new Set(conflicts.flatMap((c) => c.bindings.map(bindingId))), [conflicts]);

  const q = query.trim().toLowerCase();
  const actions = sortActions(registry.all()).filter((a) => {
    if (a.internal) return false;
    if (!q) return true;
    const keys = keybindings.bindingsFor(a.id).map((b) => `${b.keys} ${keybindings.format(b.keys)}`.toLowerCase());
    return [a.title, a.id, a.category, a.description, ...keys].some((t) => t.toLowerCase().includes(q));
  });

  const labelOf = (b: ResolvedBinding) => {
    const action = registry.get(b.actionId)!;
    return b.params !== undefined ? (action.label?.(b.params) ?? action.title) : action.title;
  };

  async function commit(keys: string) {
    if (!recording) return;
    const { actionId, index } = recording;
    setRecording(null);
    const result = await dispatch(
      "app.shortcuts.bind",
      index === null ? { actionId, keys } : { actionId, keys, replaceIndex: index },
    );
    if (result.ok) toast(`${registry.get(actionId)!.title}: ${keybindings.format(keys)}`);
  }

  /** Remove bindings, highest index first per action so indexes stay valid. */
  async function remove(bindings: ResolvedBinding[]) {
    const sorted = [...bindings].sort((a, b) => a.actionId.localeCompare(b.actionId) || b.index - a.index);
    for (const b of sorted) await dispatch("app.shortcuts.unbind", { actionId: b.actionId, index: b.index });
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    const result = await dispatch<{ imported: number; skipped: string[] }>("app.shortcuts.import", { json: await file.text() });
    if (result.ok) {
      const { imported, skipped } = result.value;
      toast(`Imported overrides for ${imported} action(s)${skipped.length ? `; skipped unknown: ${skipped.join(", ")}` : ""}.`);
    }
  }

  return (
    <Modal
      label="Keyboard shortcuts"
      onEscape={() => (recording ? setRecording(null) : void dispatch("app.shortcuts.close"))}
      className={styles.dialog}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>Keyboard Shortcuts</h2>
        <input
          data-autofocus
          type="search"
          className={styles.search}
          placeholder="Search actions or keys"
          aria-label="Search actions or keys"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className={styles.headerActions}>
          <button type="button" className={styles.button} onClick={() => fileRef.current?.click()}>
            Import…
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onImport(e.target.files?.[0])} />
          <button type="button" className={styles.button} onClick={() => void dispatch("app.shortcuts.export")}>
            Export
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => confirm("Reset every shortcut to its default?") && void dispatch("app.shortcuts.reset", {})}
          >
            Reset all
          </button>
          <button type="button" className={styles.iconButton} aria-label="Close" onClick={() => void dispatch("app.shortcuts.close")}>
            <Icon name="close" />
          </button>
        </div>
      </header>

      <div className={styles.body}>
        {conflicts.length > 0 && (
          <section className={styles.conflicts} aria-label="Conflicts">
            <h3 className={styles.conflictTitle}>
              {conflicts.length} conflict{conflicts.length > 1 ? "s" : ""}
            </h3>
            {conflicts.map((c) => (
              <div key={`${c.kind}:${c.bindings.map(bindingId).join("|")}`} className={styles.conflict}>
                {c.kind === "exact" ? (
                  <p>
                    <Kbd strokes={keybindings.formatStrokes(c.keys)} /> is assigned to{" "}
                    {c.bindings.map((b) => `“${labelOf(b)}”`).join(" and ")}. Only one runs; this is fine only if they are
                    never available at the same time.
                  </p>
                ) : (
                  <p>
                    <Kbd strokes={keybindings.formatStrokes(c.keys)} /> (“{labelOf(c.bindings[0]!)}”) starts the chord{" "}
                    <Kbd strokes={keybindings.formatStrokes(c.bindings[1]!.keys)} /> (“{labelOf(c.bindings[1]!)}”), so it
                    waits before running.
                  </p>
                )}
                <div className={styles.conflictActions}>
                  {c.kind === "exact"
                    ? c.bindings.map((keep) => (
                        <button
                          key={bindingId(keep)}
                          type="button"
                          className={styles.button}
                          onClick={() => void remove(c.bindings.filter((b) => b !== keep))}
                        >
                          Keep for “{labelOf(keep)}”
                        </button>
                      ))
                    : c.bindings.map((b) => (
                        <button key={bindingId(b)} type="button" className={styles.button} onClick={() => void remove([b])}>
                          Remove {keybindings.format(b.keys)} from “{labelOf(b)}”
                        </button>
                      ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {CATEGORY_ORDER.map((category) => {
          const inCategory = actions.filter((a) => a.category === category);
          if (!inCategory.length) return null;
          return (
            <section key={category} aria-labelledby={`sc-${category}`}>
              <h3 id={`sc-${category}`} className={styles.category}>
                {category}
              </h3>
              <ul className={styles.list}>
                {inCategory.map((action) => (
                  <ActionRow
                    key={action.id}
                    action={action}
                    bindings={keybindings.bindingsFor(action.id)}
                    overridden={keybindings.isOverridden(action.id)}
                    recording={recording?.actionId === action.id ? recording.index : undefined}
                    conflictKeys={conflictKeys}
                    formatStrokes={(k) => keybindings.formatStrokes(k)}
                    onRecord={(index) => setRecording({ actionId: action.id, index })}
                    onCommit={(keys) => void commit(keys)}
                    onCancel={() => setRecording(null)}
                    onRemove={(b) => void remove([b])}
                    onReset={() => void dispatch("app.shortcuts.reset", { actionId: action.id })}
                  />
                ))}
              </ul>
            </section>
          );
        })}
        {actions.length === 0 && <p className={styles.empty}>No actions match “{query}”.</p>}
      </div>
    </Modal>
  );
}

interface ActionRowProps {
  action: AnyAction;
  bindings: ResolvedBinding[];
  overridden: boolean;
  /** undefined: not recording; null: recording a new binding; number: re-recording that binding. */
  recording: number | null | undefined;
  conflictKeys: Set<string>;
  formatStrokes: (keys: string) => string[];
  onRecord: (index: number | null) => void;
  onCommit: (keys: string) => void;
  onCancel: () => void;
  onRemove: (b: ResolvedBinding) => void;
  onReset: () => void;
}

function ActionRow(props: ActionRowProps) {
  const { action, bindings, overridden, recording, conflictKeys, formatStrokes } = props;
  return (
    <li className={styles.row}>
      <div className={styles.info}>
        <div className={styles.actionTitle}>
          {action.title}
          {overridden && (
            <span className={styles.modified} title="Changed from default">
              modified
            </span>
          )}
          {action.kind === "query" && <span className={styles.queryTag}>query</span>}
        </div>
        <div className={styles.meta}>
          <code>{action.id}</code>
          {action.when && <span> · {describeAvailability(action)}</span>}
        </div>
      </div>
      <div className={styles.bindings}>
        {bindings.map((b) =>
          recording === b.index ? (
            <KeyRecorder key={b.index} onCommit={props.onCommit} onCancel={props.onCancel} />
          ) : (
            <span key={b.index} className={`${styles.chip} ${conflictKeys.has(bindingId(b)) ? styles.conflicted : ""}`}>
              <button
                type="button"
                className={styles.chipMain}
                onClick={() => props.onRecord(b.index)}
                aria-label={`Change shortcut ${formatStrokes(b.keys).join(" ")}${b.params !== undefined ? ` for ${action.label?.(b.params) ?? ""}` : ""}`}
              >
                <Kbd strokes={formatStrokes(b.keys)} />
                {b.params !== undefined && <span className={styles.chipParams}>{action.label?.(b.params) ?? JSON.stringify(b.params)}</span>}
              </button>
              <button type="button" className={styles.chipRemove} aria-label="Remove shortcut" onClick={() => props.onRemove(b)}>
                ×
              </button>
            </span>
          ),
        )}
        {recording === null ? (
          <KeyRecorder onCommit={props.onCommit} onCancel={props.onCancel} />
        ) : (
          <button type="button" className={styles.add} onClick={() => props.onRecord(null)} aria-label={`Add shortcut for ${action.title}`}>
            +
          </button>
        )}
        {overridden && (
          <button type="button" className={styles.reset} onClick={props.onReset}>
            Reset
          </button>
        )}
      </div>
    </li>
  );
}

function bindingId(b: ResolvedBinding): string {
  return `${b.actionId}#${b.index}`;
}
