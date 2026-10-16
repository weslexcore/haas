import { describe, expect, it } from "vitest";
import { allActions, createActionRegistry } from "../../src/actions";
import { ActionRegistry } from "../../src/core/actions/registry";
import { defineAction } from "../../src/core/actions/types";
import { normalizeChord } from "../../src/core/keybindings/combo";
import { paramsJsonSchema } from "../../src/core/manifest/build-manifest";
import { createTestRuntime } from "./helpers";

/**
 * Action completeness: the registry is the documentation, so every action
 * must describe itself well enough for a person or an AI to use it.
 */
describe("action completeness", () => {
  for (const action of allActions) {
    describe(action.id, () => {
      it("has a title and a real description", () => {
        expect(action.title.trim()).not.toBe("");
        expect(action.description.trim().length, "description too short").toBeGreaterThanOrEqual(25);
      });

      if (action.params) {
        it("has at least one example, and every example validates", () => {
          expect(action.examples?.length ?? 0, "parameterized action needs examples").toBeGreaterThan(0);
          for (const ex of action.examples ?? []) {
            expect(ex.description.trim()).not.toBe("");
            const r = action.params!.safeParse(ex.params);
            expect(r.success, `example ${JSON.stringify(ex.params)} is invalid`).toBe(true);
          }
        });

        it("describes every parameter", () => {
          const schema = paramsJsonSchema(action)!;
          const props = (schema.properties ?? {}) as Record<string, { description?: string }>;
          for (const [name, prop] of Object.entries(props)) {
            expect(prop.description, `param "${name}" needs .describe()`).toBeTruthy();
          }
        });
      }

      it("has valid default shortcuts whose params validate", () => {
        for (const s of action.defaultShortcuts ?? []) {
          expect(() => normalizeChord(s.keys, false)).not.toThrow();
          expect(() => normalizeChord(s.keys, true)).not.toThrow();
          if (s.params !== undefined) expect(action.params?.safeParse(s.params).success).toBe(true);
        }
      });
    });
  }

  it("has no conflicts among default shortcuts", async () => {
    for (const isMac of [true, false]) {
      const rt = await createTestRuntime({ isMac });
      expect(rt.keybindings.conflicts()).toEqual([]);
    }
  });

  it("builds a registry without duplicate ids", () => {
    expect(() => createActionRegistry()).not.toThrow();
  });
});

describe("ActionRegistry", () => {
  const base = { title: "T", description: "d", category: "App" as const, run: () => undefined };

  it("rejects malformed ids", () => {
    const r = new ActionRegistry();
    expect(() => r.register(defineAction({ ...base, id: "NoNamespace", kind: "command" }))).toThrow(/Invalid action id/);
  });

  it("rejects duplicate ids", () => {
    const r = new ActionRegistry();
    r.register(defineAction({ ...base, id: "a.b", kind: "command" }));
    expect(() => r.register(defineAction({ ...base, id: "a.b", kind: "command" }))).toThrow(/Duplicate/);
  });

  it("rejects undoable queries", () => {
    const r = new ActionRegistry();
    expect(() => r.register(defineAction({ ...base, id: "a.q", kind: "query", undoable: true }))).toThrow(/cannot be undoable/);
  });
});
