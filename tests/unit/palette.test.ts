import { describe, expect, it } from "vitest";
import { paramsJsonSchema } from "../../src/core/manifest/build-manifest";
import { buildRows, searchRows, type ActionRow } from "../../src/ui/palette/rows";
import { fieldsFromSchema, valuesToParams } from "../../src/ui/palette/schema-form";
import { createTestRuntime } from "./helpers";

async function rows() {
  const rt = await createTestRuntime();
  return { rt, rows: buildRows(rt.registry, rt.keybindings, rt.dispatcher.readonlyContext()) };
}

const titles = (r: ReturnType<typeof searchRows>) => r.map((x) => (x.kind === "ai" ? `AI:${x.prompt}` : x.title));

describe("palette rows", () => {
  it("lists available commands only, with variant rows for param bindings", async () => {
    const { rows: r } = await rows();
    const ids = new Set(r.map((x) => x.action.id));
    expect(ids.has("library.photos.list")).toBe(false); // query
    expect(ids.has("view.beforeAfter.toggle")).toBe(false); // unavailable outside Develop
    expect(ids.has("app.palette.open")).toBe(false); // hidden
    const loupe = r.find((x) => x.title === "Loupe View")!;
    expect(loupe).toMatchObject({ hasFixedParams: true, params: { view: "loupe" }, strokes: ["E"] });
  });

  it("reflects user overrides in the shown shortcut", async () => {
    const { rt } = await rows();
    rt.keybindings.replaceKeys("history.undo", 0, "mod+u");
    await rt.dispatch("library.rating.set", { rating: 1 });
    const r = buildRows(rt.registry, rt.keybindings, rt.dispatcher.readonlyContext());
    expect(r.find((x) => x.key === "history.undo")!.strokes).toEqual(["Ctrl+U"]);
  });
});

describe("palette search", () => {
  it("matches multiple terms in any field", async () => {
    const { rows: r } = await rows();
    expect(titles(searchRows(r, "dev view", []))[0]).toBe("Develop View");
    expect(titles(searchRows(r, "rating 3", []))).toContain("Rate ★★★");
  });

  it("always offers Ask AI last for a non-empty query", async () => {
    const { rows: r } = await rows();
    expect(titles(searchRows(r, "zzzz qqq", []))).toEqual(["AI:zzzz qqq"]);
  });

  it("? switches to AI-only mode", async () => {
    const { rows: r } = await rows();
    expect(titles(searchRows(r, "? warm it up", []))).toEqual(["AI:warm it up"]);
  });

  it("puts recent actions first", async () => {
    const { rows: r } = await rows();
    const out = searchRows(r, "", ["library.selection.all"]) as ActionRow[];
    expect(out[0]!.key).toBe("library.selection.all");
    const ranked = searchRows(r, "view", ["view.set {\"view\":\"develop\"}"]) as ActionRow[];
    expect(ranked[0]!.title).toBe("Develop View");
  });
});

describe("schema-generated param form", () => {
  it("maps schema types onto controls", async () => {
    const { rt } = await rows();
    const fields = fieldsFromSchema(paramsJsonSchema(rt.registry.get("library.rating.set")!));
    expect(fields.map((f) => [f.name, f.kind, f.required])).toEqual([
      ["rating", "choice", true],
      ["photoIds", "list", false],
      ["advance", "boolean", false],
    ]);
    expect(fields[0]!.options!.map((o) => o.value)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("coerces raw values and omits empty optionals", async () => {
    const { rt } = await rows();
    const fields = fieldsFromSchema(paramsJsonSchema(rt.registry.get("library.rating.set")!));
    expect(valuesToParams(fields, { rating: 3, photoIds: "" })).toEqual({ rating: 3 });
    expect(valuesToParams(fields, { rating: 3, photoIds: "a, b" })).toEqual({ rating: 3, photoIds: ["a", "b"] });
  });

  it("uses schema defaults", async () => {
    const { rt } = await rows();
    const fields = fieldsFromSchema(paramsJsonSchema(rt.registry.get("app.manifest.export")!));
    expect(fields[0]).toMatchObject({ name: "format", kind: "choice", defaultValue: "json" });
  });
});
