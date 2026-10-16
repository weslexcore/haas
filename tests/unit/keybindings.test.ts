import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OVERRIDES_SETTINGS_KEY } from "../../src/core/keybindings/service";
import { createTestRuntime, flush, key } from "./helpers";

const input = { tagName: "INPUT", type: "text" };

describe("KeybindingService", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  it("dispatches bound actions with their params", async () => {
    const rt = await createTestRuntime();
    expect(rt.keybindings.handleKeyDown(key("3"))).toBe(true);
    await flush();
    expect(rt.store.getState().photos.byId["DSC_0001.jpg"]!.rating).toBe(3);
  });

  it("respects mod per platform", async () => {
    const mac = await createTestRuntime({ isMac: true });
    mac.keybindings.handleKeyDown(key("k", { meta: true }));
    await flush();
    expect(mac.store.getState().palette.open).toBe(true);

    const pc = await createTestRuntime({ isMac: false });
    expect(pc.keybindings.handleKeyDown(key("k", { meta: true }))).toBe(false);
    pc.keybindings.handleKeyDown(key("k", { ctrl: true }));
    await flush();
    expect(pc.store.getState().palette.open).toBe(true);
  });

  it("ignores bindings while typing in a text field, unless allowed", async () => {
    const rt = await createTestRuntime();
    expect(rt.keybindings.handleKeyDown(key("3", {}, input))).toBe(false);
    expect(rt.keybindings.handleKeyDown(key("k", { ctrl: true }, input))).toBe(true); // mod+k allowInInput
    expect(rt.keybindings.handleKeyDown(key("3", {}, { tagName: "INPUT", type: "checkbox" }))).toBe(true);
  });

  it("skips bindings whose action is unavailable", async () => {
    const rt = await createTestRuntime();
    expect(rt.keybindings.handleKeyDown(key("\\"))).toBe(false); // only in Develop
    await rt.dispatch("view.set", { view: "develop" });
    expect(rt.keybindings.handleKeyDown(key("\\"))).toBe(true);
  });

  it("handles multi-key chords", async () => {
    const rt = await createTestRuntime();
    const ev = key("t");
    expect(rt.keybindings.handleKeyDown(ev)).toBe(true);
    expect(ev.prevented).toBe(true);
    expect(rt.keybindings.pendingChord).toBe("t");
    rt.keybindings.handleKeyDown(key("t"));
    await flush();
    expect(rt.store.getState().theme).toBe("dark");
  });

  it("abandons a chord on an unrelated key and handles that key fresh", async () => {
    const rt = await createTestRuntime();
    rt.keybindings.handleKeyDown(key("t"));
    rt.keybindings.handleKeyDown(key("e"));
    await flush();
    expect(rt.store.getState().theme).toBe("system");
    expect(rt.store.getState().view).toBe("loupe");
  });

  it("waits for a longer chord, then falls back to the shorter binding on timeout", async () => {
    const rt = await createTestRuntime();
    rt.keybindings.addBinding("view.set", "g g", { view: "develop" }); // now "g" prefixes "g g"
    rt.keybindings.handleKeyDown(key("g"));
    expect(rt.store.getState().view).toBe("grid");
    await rt.dispatch("view.set", { view: "loupe" });
    vi.advanceTimersByTime(1000);
    await flush();
    expect(rt.store.getState().view).toBe("grid");

    rt.keybindings.handleKeyDown(key("g"));
    rt.keybindings.handleKeyDown(key("g"));
    await flush();
    expect(rt.store.getState().view).toBe("develop");
  });

  it("opens the palette's param step for a binding without params", async () => {
    const rt = await createTestRuntime();
    rt.keybindings.addBinding("library.rating.set", "r");
    rt.keybindings.handleKeyDown(key("r"));
    await flush();
    expect(rt.store.getState().palette).toEqual({ open: true, actionId: "library.rating.set" });
  });

  it("user overrides replace defaults, persist, and reset", async () => {
    const rt = await createTestRuntime();
    rt.keybindings.replaceKeys("view.set", 0, "h"); // grid: g → h
    expect(rt.keybindings.isOverridden("view.set")).toBe(true);
    expect(rt.keybindings.bindingsFor("view.set").map((b) => b.keys)).toEqual(["h", "e", "d"]);
    expect(rt.keybindings.handleKeyDown(key("g"))).toBe(false);
    expect(await rt.services.settings.get(OVERRIDES_SETTINGS_KEY)).toHaveProperty("view.set");

    rt.keybindings.resetToDefault("view.set");
    expect(rt.keybindings.bindingsFor("view.set")[0]!.keys).toBe("g");
  });

  it("drops the override when bindings match the defaults again", async () => {
    const rt = await createTestRuntime();
    rt.keybindings.replaceKeys("history.undo", 0, "ctrl+u");
    rt.keybindings.replaceKeys("history.undo", 0, "mod+z");
    expect(rt.keybindings.isOverridden("history.undo")).toBe(false);
  });

  it("reports exact and prefix conflicts", async () => {
    const rt = await createTestRuntime();
    rt.keybindings.addBinding("navigation.next", "p");
    rt.keybindings.addBinding("navigation.first", "x x");
    const conflicts = rt.keybindings.conflicts();
    expect(conflicts).toContainEqual(expect.objectContaining({ kind: "exact", keys: "p" }));
    expect(conflicts).toContainEqual(expect.objectContaining({ kind: "prefix", keys: "x" }));
  });

  it("round-trips through JSON export/import and skips unknown actions", async () => {
    const a = await createTestRuntime();
    a.keybindings.replaceKeys("history.redo", 0, "mod+y");
    const json = a.keybindings.exportJSON();

    const b = await createTestRuntime();
    const withUnknown = JSON.parse(json);
    withUnknown.overrides["gone.action"] = [{ keys: "q" }];
    expect(b.keybindings.importJSON(JSON.stringify(withUnknown))).toEqual({ imported: 1, skipped: ["gone.action"] });
    expect(b.keybindings.bindingsFor("history.redo")[0]!.keys).toBe("mod+y");
    expect(() => b.keybindings.importJSON('{"version":2}')).toThrow();
  });

  it("loads persisted overrides on startup", async () => {
    const rt = await createTestRuntime();
    await rt.services.settings.set(OVERRIDES_SETTINGS_KEY, { "view.set": [{ keys: "1", params: { view: "grid" } }] });
    await rt.keybindings.load();
    expect(rt.keybindings.bindingsFor("view.set").map((b) => b.keys)).toEqual(["1"]);
  });

  it("only fires input-safe bindings while a modal is open", async () => {
    const rt = await createTestRuntime();
    expect(rt.keybindings.handleKeyDown(key("3"), { modalOpen: true })).toBe(false);
    expect(rt.keybindings.handleKeyDown(key("k", { ctrl: true }), { modalOpen: true })).toBe(true);
  });

  it("can be managed through actions (so the AI can rebind keys)", async () => {
    const rt = await createTestRuntime();
    expect((await rt.dispatch("app.shortcuts.bind", { actionId: "view.set", keys: "shift+g", params: { view: "grid" } })).ok).toBe(true);
    expect(rt.keybindings.bindingsFor("view.set").map((b) => b.keys)).toContain("shift+g");
    const bad = await rt.dispatch("app.shortcuts.bind", { actionId: "view.set", keys: "q", params: { view: "nope" } });
    expect(bad).toMatchObject({ ok: false, error: "failed" });
    const malformed = await rt.dispatch("app.shortcuts.bind", { actionId: "view.set", keys: "shift+/" });
    expect(malformed).toMatchObject({ ok: false, error: "failed" });

    await rt.dispatch("app.shortcuts.unbind", { actionId: "history.undo", index: 0 });
    expect(rt.keybindings.bindingsFor("history.undo")).toEqual([]);
    await rt.dispatch("app.shortcuts.reset", {});
    expect(rt.keybindings.isOverridden("view.set")).toBe(false);
    expect(rt.keybindings.bindingsFor("history.undo")).toHaveLength(1);

    await rt.dispatch("app.shortcuts.export");
    expect(rt.downloads[0]!.fileName).toBe("photo-shortcuts.json");
  });

  it("does nothing while suspended", async () => {
    const rt = await createTestRuntime();
    rt.keybindings.setSuspended(true);
    expect(rt.keybindings.handleKeyDown(key("3"))).toBe(false);
  });
});
