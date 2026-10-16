import { describe, expect, it } from "vitest";
import { z } from "zod";
import { allActions } from "../../src/actions";
import { defineAction } from "../../src/core/actions/types";
import { createTestRuntime } from "./helpers";

const ratingOf = (rt: Awaited<ReturnType<typeof createTestRuntime>>, id: string) => rt.store.getState().photos.byId[id]!.rating;

describe("dispatcher", () => {
  it("rejects unknown actions", async () => {
    const rt = await createTestRuntime();
    expect(await rt.dispatch("nope.nope")).toMatchObject({ ok: false, error: "unknown_action" });
  });

  it("validates params with Zod for every caller", async () => {
    const rt = await createTestRuntime();
    const r = await rt.dispatch("library.rating.set", { rating: 9 }, { source: "ai" });
    expect(r).toMatchObject({ ok: false, error: "invalid_params" });
    if (!r.ok) expect(r.issues?.[0]?.path).toEqual(["rating"]);
  });

  it("rejects params for actions that take none", async () => {
    const rt = await createTestRuntime();
    expect(await rt.dispatch("navigation.next", { x: 1 })).toMatchObject({ ok: false, error: "invalid_params" });
    expect((await rt.dispatch("navigation.next", {})).ok).toBe(true);
  });

  it("refuses unavailable actions and explains why", async () => {
    const rt = await createTestRuntime();
    const r = await rt.dispatch("view.beforeAfter.toggle");
    expect(r).toMatchObject({ ok: false, error: "unavailable" });
    if (!r.ok) expect(r.message).toContain("the current view is Develop");
    await rt.dispatch("view.set", { view: "develop" });
    expect((await rt.dispatch("view.beforeAfter.toggle")).ok).toBe(true);
  });

  it("returns query results", async () => {
    const rt = await createTestRuntime({ photos: 5 });
    const r = await rt.dispatch<{ total: number }>("library.photos.list", {});
    expect(r).toMatchObject({ ok: true, value: { total: 5 } });
  });

  it("records undoable commands and undoes/redoes them", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("library.rating.set", { rating: 4 });
    expect(ratingOf(rt, "DSC_0001.jpg")).toBe(4);
    expect(rt.history.getSnapshot().undoLabel).toBe("Rate ★★★★");

    await rt.dispatch("history.undo");
    expect(ratingOf(rt, "DSC_0001.jpg")).toBe(0);
    await rt.dispatch("history.redo");
    expect(ratingOf(rt, "DSC_0001.jpg")).toBe(4);
  });

  it("does not record non-undoable commands", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("view.set", { view: "loupe" });
    await rt.dispatch("navigation.next");
    expect(rt.history.canUndo).toBe(false);
  });

  it("groups a transaction into one undo step", async () => {
    const rt = await createTestRuntime();
    await rt.dispatcher.transaction("Cull", async (d) => {
      await d.dispatch("library.rating.set", { rating: 5, photoIds: ["DSC_0001.jpg"] });
      await d.dispatch("library.flag.set", { flag: "pick", photoIds: ["DSC_0001.jpg", "DSC_0002.jpg"] });
    });
    expect(rt.history.entries).toHaveLength(1);
    expect(rt.history.entries[0]!.label).toBe("Cull");

    await rt.dispatch("history.undo");
    const s = rt.store.getState();
    expect(s.photos.byId["DSC_0001.jpg"]).toMatchObject({ rating: 0, flag: "none" });
    expect(s.photos.byId["DSC_0002.jpg"]!.flag).toBe("none");
  });

  it("rolls back a transaction that throws", async () => {
    const rt = await createTestRuntime();
    await expect(
      rt.dispatcher.transaction("Bad", async (d) => {
        await d.dispatch("library.rating.set", { rating: 2 });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(ratingOf(rt, "DSC_0001.jpg")).toBe(0);
    expect(rt.history.canUndo).toBe(false);
  });

  it("rolls back only the failing command inside a transaction", async () => {
    const failing = defineAction({
      id: "test.failing",
      title: "Fail",
      description: "Changes a rating then throws.",
      category: "Library",
      kind: "command",
      undoable: true,
      params: z.object({ id: z.string() }),
      examples: [{ params: { id: "DSC_0001.jpg" }, description: "x" }],
      run({ id }, ctx) {
        ctx.update((s) => {
          s.photos.byId[id]!.rating = 1;
        });
        throw new Error("nope");
      },
    });
    const rt = await createTestRuntime({ actions: [...allActions, failing] });
    await rt.dispatcher.transaction("Mixed", async (d) => {
      await d.dispatch("library.rating.set", { rating: 5, photoIds: ["DSC_0002.jpg"] });
      const r = await d.dispatch("test.failing", { id: "DSC_0001.jpg" });
      expect(r).toMatchObject({ ok: false, error: "failed", message: "nope" });
    });
    expect(ratingOf(rt, "DSC_0001.jpg")).toBe(0);
    expect(ratingOf(rt, "DSC_0002.jpg")).toBe(5);
    await rt.dispatch("history.undo");
    expect(ratingOf(rt, "DSC_0002.jpg")).toBe(0);
  });

  it("coalesces consecutive runs with the same key into one undo step", async () => {
    const drag = defineAction({
      id: "test.drag",
      title: "Drag",
      description: "Sets a rating as if dragging a slider.",
      category: "Library",
      kind: "command",
      undoable: true,
      params: z.object({ value: z.number() }),
      examples: [{ params: { value: 1 }, description: "x" }],
      coalesce: () => "drag",
      run({ value }, ctx) {
        ctx.update((s) => {
          s.photos.byId["DSC_0001.jpg"]!.rating = value;
        });
      },
    });
    const rt = await createTestRuntime({ actions: [...allActions, drag] });
    for (const v of [1, 2, 3, 4]) await rt.dispatch("test.drag", { value: v });
    expect(rt.history.entries).toHaveLength(1);
    await rt.dispatch("library.flag.set", { flag: "pick" });
    await rt.dispatch("test.drag", { value: 5 }); // not merged across another step
    expect(rt.history.entries).toHaveLength(3);
    await rt.dispatch("history.undo");
    await rt.dispatch("history.undo");
    await rt.dispatch("history.undo");
    expect(ratingOf(rt, "DSC_0001.jpg")).toBe(0);
  });

  it("rolls back recorded side effects when a command fails", async () => {
    const log: string[] = [];
    const failing = defineAction({
      id: "test.effectThenFail",
      title: "Effect then fail",
      description: "Records a side effect, then throws.",
      category: "Library",
      kind: "command",
      undoable: true,
      run(_, ctx) {
        ctx.recordEffect({ undo: async () => void log.push("undone"), redo: async () => void log.push("redone") });
        throw new Error("nope");
      },
    });
    const rt = await createTestRuntime({ actions: [...allActions, failing] });
    expect(await rt.dispatch("test.effectThenFail")).toMatchObject({ ok: false });
    expect(log).toEqual(["undone"]);
    expect(rt.history.canUndo).toBe(false);
  });

  it("clears redo after a new change", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("library.rating.set", { rating: 1 });
    await rt.dispatch("history.undo");
    await rt.dispatch("library.rating.set", { rating: 2 });
    expect(rt.history.canRedo).toBe(false);
    expect((await rt.dispatch("history.redo")).ok).toBe(false);
  });

  it("notifies dispatch listeners with the source", async () => {
    const rt = await createTestRuntime();
    const seen: string[] = [];
    rt.dispatcher.onDispatch((e) => seen.push(`${e.source}:${e.id}`));
    await rt.dispatch("view.set", { view: "grid" }, { source: "palette" });
    expect(seen).toEqual(["palette:view.set"]);
  });
});

describe("actions", () => {
  it("navigation clamps at the ends", async () => {
    const rt = await createTestRuntime({ photos: 3 });
    await rt.dispatch("navigation.previous");
    expect(rt.store.getState().selection.activeId).toBe("DSC_0001.jpg");
    await rt.dispatch("navigation.last");
    await rt.dispatch("navigation.next");
    expect(rt.store.getState().selection).toEqual({ activeId: "DSC_0003.jpg", ids: ["DSC_0003.jpg"] });
  });

  it("theme toggle resolves 'system' and persists", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("app.theme.toggle"); // system (light) → dark
    expect(rt.store.getState().theme).toBe("dark");
    expect(await rt.services.settings.get("app.theme")).toBe("dark");
  });

  it("palette open toggles, and opens on a param step", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("app.palette.open");
    expect(rt.store.getState().palette.open).toBe(true);
    await rt.dispatch("app.palette.open");
    expect(rt.store.getState().palette.open).toBe(false);
    await rt.dispatch("app.palette.open", { actionId: "library.rating.set" });
    expect(rt.store.getState().palette).toEqual({ open: true, actionId: "library.rating.set" });
  });

  it("ask AI fails clearly while no API key is configured", async () => {
    const rt = await createTestRuntime();
    await rt.services.ai.configure({ apiKey: null });
    const r = await rt.dispatch("app.ai.ask", { prompt: "reject blurry photos" });
    expect(r).toMatchObject({ ok: false, error: "failed" });
    if (!r.ok) expect(r.message).toMatch(/API key/);
  });

  it("exports the manifest through the download service", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("app.manifest.export", { format: "skill" });
    expect(rt.downloads[0]!.fileName).toBe("SKILL.md");
    expect(rt.downloads[0]!.content).toContain("`library.rating.set`");
  });
});
