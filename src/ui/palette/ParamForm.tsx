import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { z } from "zod";
import type { AnyAction } from "../../core/actions/types";
import { paramsJsonSchema } from "../../core/manifest/build-manifest";
import { fieldsFromSchema, initialValues, valuesToParams, type FieldSpec, type RawValues } from "./schema-form";
import styles from "./CommandPalette.module.css";

interface ParamFormProps {
  action: AnyAction;
  onSubmit: (params: unknown) => void;
  onBack: () => void;
}

/** Parameter step generated from the action's schema. Validates with the same Zod schema as the dispatcher. */
export function ParamForm({ action, onSubmit, onBack }: ParamFormProps) {
  const fields = useMemo(() => fieldsFromSchema(paramsJsonSchema(action)), [action]);
  const [values, setValues] = useState<RawValues>(() => initialValues(fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("[data-field-focus]")?.focus();
  }, []);

  // With a single required choice, picking an option runs the action straight away.
  const instant = fields.length > 0 && fields.filter((f) => f.required).length === 1 && fields[0]!.kind === "choice" && fields[0]!.required;

  function submit(next: RawValues = values) {
    const params = valuesToParams(fields, next);
    const result = action.params!.safeParse(params);
    if (!result.success) {
      setErrors(issuesByField(result.error.issues));
      return;
    }
    onSubmit(params);
  }

  function set(name: string, value: RawValues[string], submitNow = false) {
    const next = { ...values, [name]: value };
    setValues(next);
    setErrors((e) => ({ ...e, [name]: "" }));
    if (submitNow) submit(next);
  }

  return (
    <form
      ref={formRef}
      className={styles.paramForm}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className={styles.paramHeader}>
        <button type="button" className={styles.back} onClick={onBack} aria-label="Back to search">
          ←
        </button>
        <div>
          <div className={styles.paramTitle}>{action.title}</div>
          <div className={styles.paramDesc}>{action.description}</div>
        </div>
      </div>

      {fields.map((f, i) => (
        <Field
          key={f.name}
          field={f}
          value={values[f.name]}
          error={errors[f.name]}
          autoFocus={i === 0}
          onChange={(v, submitNow) => set(f.name, v, submitNow && instant)}
          onEnter={() => submit()}
        />
      ))}
      {errors._form && <p className={styles.error}>{errors._form}</p>}

      <div className={styles.paramFooter}>
        <span className={styles.hint}>
          <kbd>↩</kbd> run · <kbd>Esc</kbd> back
        </span>
        <button type="submit" className={styles.run}>
          Run
        </button>
      </div>
    </form>
  );
}

interface FieldProps {
  field: FieldSpec;
  value: RawValues[string];
  error?: string;
  autoFocus: boolean;
  onChange: (value: RawValues[string], submitNow?: boolean) => void;
  onEnter: () => void;
}

function Field({ field, value, error, autoFocus, onChange, onEnter }: FieldProps) {
  const id = `param-${field.name}`;
  const focusProps = autoFocus ? { "data-field-focus": true } : {};
  const describedBy = `${id}-desc${error ? ` ${id}-err` : ""}`;

  let control;
  if (field.kind === "choice") {
    const options = field.options ?? [];
    const index = options.findIndex((o) => o.value === value);
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      const move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (move) {
        e.preventDefault();
        const next = options[(Math.max(index, 0) + move + options.length) % options.length]!;
        onChange(next.value);
        (e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (index >= 0) onChange(options[index]!.value, true);
        else onEnter();
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        const match = options.find((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
        if (match) {
          e.preventDefault();
          onChange(match.value, true);
        }
      }
    };
    control = (
      <div role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={describedBy} className={styles.choices} onKeyDown={onKeyDown}>
        {options.map((o, i) => {
          const checked = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={checked}
              data-value={o.value}
              tabIndex={checked || (index < 0 && i === 0) ? 0 : -1}
              className={styles.choice}
              onClick={() => onChange(o.value, true)}
              {...(i === 0 ? focusProps : {})}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  } else if (field.kind === "boolean") {
    control = (
      <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} aria-describedby={describedBy} {...focusProps} />
    );
  } else {
    control = (
      <input
        id={id}
        className={styles.input}
        type={field.kind === "number" ? "number" : "text"}
        min={field.min}
        max={field.max}
        step={field.step}
        value={value === undefined ? "" : String(value)}
        placeholder={field.kind === "list" ? "comma-separated" : field.kind === "json" ? "JSON" : undefined}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={describedBy}
        aria-invalid={!!error}
        {...focusProps}
      />
    );
  }

  return (
    <div className={styles.field}>
      <label id={`${id}-label`} htmlFor={id} className={styles.fieldLabel}>
        {field.label}
        {!field.required && <span className={styles.optional}> optional</span>}
      </label>
      {control}
      <div id={`${id}-desc`} className={styles.fieldDesc}>
        {field.description}
      </div>
      {error && (
        <div id={`${id}-err`} className={styles.error} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function issuesByField(issues: z.core.$ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_form";
    out[key] ??= issue.message;
  }
  return out;
}
