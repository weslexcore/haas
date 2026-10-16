import type { JSONSchema } from "../../core/manifest/build-manifest";

/**
 * Turns an action's params JSON Schema into form field descriptions. The
 * same JSON Schema is what the AI sees, so UI and AI share one source.
 */
export type FieldKind = "choice" | "number" | "boolean" | "text" | "list" | "json";

export interface FieldSpec {
  name: string;
  label: string;
  description: string;
  required: boolean;
  kind: FieldKind;
  options?: Array<{ value: string | number; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: unknown;
}

export type RawValues = Record<string, string | boolean | number | undefined>;

export function fieldsFromSchema(schema: JSONSchema | null): FieldSpec[] {
  if (!schema) return [];
  const props = (schema.properties ?? {}) as Record<string, JSONSchema>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(props).map(([name, p]) => {
    const base = {
      name,
      label: humanize(name),
      description: String(p.description ?? ""),
      required: required.has(name),
      defaultValue: p.default,
    };
    if (Array.isArray(p.enum)) {
      return { ...base, kind: "choice", options: p.enum.map((v) => ({ value: v as string, label: humanize(String(v)) })) };
    }
    const min = typeof p.minimum === "number" ? p.minimum : undefined;
    const max = typeof p.maximum === "number" ? p.maximum : undefined;
    if (p.type === "integer" && min !== undefined && max !== undefined && max - min <= 10) {
      return {
        ...base,
        kind: "choice",
        options: Array.from({ length: max - min + 1 }, (_, i) => ({ value: min + i, label: String(min + i) })),
      };
    }
    if (p.type === "integer" || p.type === "number") {
      return { ...base, kind: "number", min, max, step: p.type === "integer" ? 1 : 0.01 };
    }
    if (p.type === "boolean") return { ...base, kind: "boolean" };
    if (p.type === "string") return { ...base, kind: "text" };
    if (p.type === "array") return { ...base, kind: "list" };
    return { ...base, kind: "json" };
  });
}

export function initialValues(fields: FieldSpec[]): RawValues {
  const values: RawValues = {};
  for (const f of fields) {
    if (f.defaultValue === undefined) continue;
    values[f.name] = typeof f.defaultValue === "object" ? JSON.stringify(f.defaultValue) : (f.defaultValue as string | number | boolean);
  }
  return values;
}

/** Convert raw form values into a params object; empty optional fields are omitted. */
export function valuesToParams(fields: FieldSpec[], raw: RawValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = raw[f.name];
    if (v === undefined || v === "") continue;
    switch (f.kind) {
      case "number":
        out[f.name] = Number(v);
        break;
      case "boolean":
        out[f.name] = !!v;
        break;
      case "list":
        out[f.name] = String(v)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "json":
        try {
          out[f.name] = JSON.parse(String(v));
        } catch {
          out[f.name] = v; // let schema validation report it
        }
        break;
      default:
        out[f.name] = v;
    }
  }
  return out;
}

function humanize(s: string): string {
  const spaced = s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
