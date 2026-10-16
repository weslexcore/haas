import { useState } from "react";
import { AI_MODELS } from "../../adapters/ai/anthropic-provider";
import type { AIModel } from "../../core/services";
import { useAppState, useDispatch } from "../hooks";
import { useRuntime } from "../runtime-context";
import { Modal } from "../shell/Modal";
import styles from "./AiSettings.module.css";

export function AiSettings() {
  const open = useAppState((s) => s.ai.settingsOpen);
  return open ? <AiSettingsDialog /> : null;
}

function AiSettingsDialog() {
  const { services } = useRuntime();
  const dispatch = useDispatch("ui");
  const [key, setKey] = useState("");
  const [model, setModel] = useState<AIModel>(services.ai.model);
  const [configured, setConfigured] = useState(services.ai.isConfigured());
  const close = () => void dispatch("app.ai.settings.close");

  const save = async () => {
    const r = await dispatch<{ configured: boolean }>("app.ai.configure", { ...(key.trim() ? { apiKey: key.trim() } : {}), model });
    if (r.ok) {
      setConfigured(r.value.configured);
      setKey("");
      close();
    }
  };

  return (
    <Modal label="AI settings" onEscape={close} onBackdropClick={close} className={styles.dialog}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 className={styles.title}>AI Settings</h2>
        <p className={styles.note}>
          Requests go straight from this browser to the Anthropic API using your own API key. The key is stored only in this
          browser (local storage), so anyone with access to this browser profile could read it. Use a key you can revoke.
        </p>
        <label className={styles.field}>
          <span>Anthropic API key {configured && <em className={styles.saved}>(saved)</em>}</span>
          <input
            data-autofocus
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={configured ? "Enter a new key to replace it" : "sk-ant-…"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value as AIModel)}>
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.actions}>
          {configured && (
            <button
              type="button"
              className={styles.danger}
              onClick={async () => {
                const r = await dispatch("app.ai.configure", { apiKey: null });
                if (r.ok) setConfigured(false);
              }}
            >
              Remove key
            </button>
          )}
          <span className={styles.spacer} />
          <button type="button" className={styles.secondary} onClick={close}>
            Cancel
          </button>
          <button type="submit" className={styles.primary}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
