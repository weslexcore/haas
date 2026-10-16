// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { allActions } from "../../src/actions";
import { AnthropicProvider } from "../../src/adapters/ai/anthropic-provider";
import { MemorySettingsStore } from "../../src/adapters/settings";
import { StubAIProvider } from "../../src/adapters/stub-ai-provider";
import { reviewStep } from "../../src/core/ai/plan";
import { MetadataSync } from "../../src/core/library/metadata-sync";
import type { Plan } from "../../src/core/services";
import { MemorySource } from "../../src/adapters/memory-source";
import { createRuntime } from "../../src/core/runtime";
import { allMenus } from "../../src/menus";
import { FakePreviews, TestLibraryProvider } from "./helpers";
import { MemoryMetadataStore } from "../../src/adapters/db";

async function runtimeWithAi(respond?: ConstructorParameters<typeof StubAIProvider>[0]) {
  const ai = new StubAIProvider(respond);
  const library = new TestLibraryProvider(10);
  const rt = createRuntime({
    actions: allActions,
    menus: allMenus,
    platform: { isMac: false, prefersDark: () => false },
    services: {
      settings: new MemorySettingsStore(),
      library,
      metadata: new MemoryMetadataStore(),
      previews: new FakePreviews(),
      persistence: { flush: async () => undefined },
      vision: {
        capture: async (photo, opts) => ({ photoId: photo.id, mediaType: "image/jpeg" as const, data: "AAAA", width: opts.maxEdge, height: Math.round(opts.maxEdge * 2 / 3), edited: opts.edited && !!photo.edit }),
      },
      exporter: { renderJpeg: async () => ({ blob: new Blob([]), width: 1, height: 1 }) },
      ai,
      downloads: { save: () => undefined, saveBlob: () => undefined },
    },
  });
  await rt.dispatch("library.sample.load");
  return { rt, ai, library };
}

const photo = (rt: Awaited<ReturnType<typeof runtimeWithAi>>["rt"], id = "DSC_0001.jpg") => rt.store.getState().photos.byId[id]!;

describe("plan review", () => {
  it("validates each step against the registry and schemas", async () => {
    const { rt } = await runtimeWithAi();
    const ctx = rt.dispatcher.readonlyContext();
    const r = (actionId: string, params?: unknown) => reviewStep(rt.registry, ctx, { actionId, params, reason: "x" });
    expect(r("library.rating.set", { rating: 3 })).toMatchObject({ valid: true, label: "Rate ★★★", impact: "on 1 photo", previewable: true });
    expect(r("library.rating.set", { rating: 9 })).toMatchObject({ valid: false, error: expect.stringContaining("rating") });
    expect(r("nope.nope")).toMatchObject({ valid: false });
    expect(r("library.photos.list")).toMatchObject({ valid: false, error: expect.stringContaining("only reads") });
    expect(r("app.ai.configure", { apiKey: "x" })).toMatchObject({ valid: false });
    expect(r("history.undo")).toMatchObject({ valid: false });
    await rt.dispatch("library.flag.set", { flag: "reject", photoIds: ["DSC_0007.jpg"] });
    expect(r("library.rejected.remove")).toMatchObject({ valid: true, previewable: false, impact: "on 1 photo" });
    expect(r("develop.adjust", { setting: "exposure", delta: 0.3, photoIds: ["DSC_0001.jpg", "DSC_0002.jpg"] })).toMatchObject({ impact: "on 2 photos" });
  });
});

describe("app.ai.ask", () => {
  it("sends the manifest, context and read-only tools; the model can look things up", async () => {
    const { rt, ai } = await runtimeWithAi(async (req) => {
      const found = (await req.callTool("library.photos.list", { minRating: 0, limit: 2 })) as { photos: Array<{ id: string }> };
      await expect(req.callTool("library.rating.set", { rating: 5 })).rejects.toThrow(/read-only/);
      return { summary: "Rate the first two.", steps: [{ actionId: "library.rating.set", params: { rating: 4, photoIds: found.photos.map((p) => p.id) }, reason: "best two" }] };
    });
    const r = await rt.dispatch<{ steps: Array<{ valid: boolean; params: unknown }> }>("app.ai.ask", { prompt: "rate the first two 4 stars" });
    expect(r).toMatchObject({ ok: true, value: { summary: "Rate the first two.", model: "claude-opus-5-5" } });
    if (r.ok) expect(r.value.steps[0]).toMatchObject({ valid: true, params: { rating: 4, photoIds: ["DSC_0001.jpg", "DSC_0002.jpg"] } });
    const req = ai.requests[0]!;
    expect(req.tools.every((t) => rt.registry.get(t.actionId)!.kind === "query")).toBe(true);
    expect(req.tools.map((t) => t.actionId)).toContain("library.photos.list");
    expect(req.context).toMatchObject({ photoCount: 10 });
    expect((req.manifest as { actions: unknown[] }).actions.length).toBeGreaterThan(30);
    expect(photo(rt).rating).toBe(0); // asking changes nothing
  });

  it("fails clearly without an API key", async () => {
    const { rt, ai } = await runtimeWithAi();
    ai.configured = false;
    expect(await rt.dispatch("app.ai.ask", { prompt: "x" })).toMatchObject({ ok: false, message: expect.stringContaining("API key") });
  });
});

describe("seeing photos", () => {
  it("library.photos.view returns images, edited by default, within per-size limits", async () => {
    const { rt } = await runtimeWithAi();
    await rt.dispatch("develop.adjust", { setting: "exposure", value: 1 });
    const r = await rt.dispatch<{ kind: string; images: Array<{ photoId: string; width: number; edited: boolean }> }>("library.photos.view", {
      photoIds: ["DSC_0001.jpg", "DSC_0002.jpg"],
    });
    expect(r).toMatchObject({ ok: true, value: { kind: "images" } });
    if (r.ok) {
      expect(r.value.images.map((i) => [i.photoId, i.width, i.edited])).toEqual([["DSC_0001.jpg", 1024, true], ["DSC_0002.jpg", 1024, false]]);
    }
    const original = await rt.dispatch<{ images: Array<{ edited: boolean }> }>("library.photos.view", { photoIds: ["DSC_0001.jpg"], original: true, size: "detail" });
    if (original.ok) expect(original.value.images[0]).toMatchObject({ edited: false, width: 1568 });
    const tooMany = await rt.dispatch("library.photos.view", { photoIds: ["DSC_0001.jpg", "DSC_0002.jpg", "DSC_0003.jpg", "DSC_0004.jpg"], size: "detail" });
    expect(tooMany).toMatchObject({ ok: false, message: expect.stringContaining("At most 3") });
  });

  it("the model can call it while planning", async () => {
    const { rt, ai } = await runtimeWithAi(async (req) => {
      const seen = (await req.callTool("library.photos.view", { photoIds: ["DSC_0001.jpg"], size: "thumbnail" })) as { kind: string };
      expect(seen.kind).toBe("images");
      return { summary: "Looked.", steps: [] };
    });
    expect((await rt.dispatch("app.ai.ask", { prompt: "is this sharp?" })).ok).toBe(true);
    expect(ai.requests[0]!.tools.map((t) => t.actionId)).toContain("library.photos.view");
  });
});

describe("plan preview and apply", () => {
  const steps = [
    { actionId: "library.rating.set", params: { rating: 5 } },
    { actionId: "develop.adjust", params: { setting: "exposure", value: 1 } },
    { actionId: "library.filter.set", params: { minRating: 5 } },
  ];

  it("preview shows the result without history, and ending it restores everything", async () => {
    const { rt } = await runtimeWithAi();
    const before = rt.store.getState();
    await rt.plans.preview(steps);
    expect(photo(rt).rating).toBe(5);
    expect(photo(rt).edit?.exposure).toBe(1);
    expect(rt.store.getState().library.filter.minRating).toBe(5);
    expect(rt.store.getState().ai.previewing).toBe(true);
    expect(rt.history.canUndo).toBe(false);

    await rt.plans.endPreview();
    expect(rt.store.getState()).toEqual(before);
  });

  it("other edits are refused while previewing, but browsing still works", async () => {
    const { rt } = await runtimeWithAi();
    await rt.plans.preview(steps);
    expect(await rt.dispatch("library.flag.set", { flag: "pick" }, { source: "keyboard" })).toMatchObject({ ok: false, message: expect.stringContaining("AI plan") });
    expect((await rt.dispatch("view.set", { view: "loupe" }, { source: "keyboard" })).ok).toBe(true);
    await rt.plans.endPreview();
  });

  it("apply runs the steps as one undoable 'AI:' transaction", async () => {
    const { rt } = await runtimeWithAi();
    await rt.plans.preview(steps);
    await rt.plans.apply(steps, "Best photos, brighter");
    expect(photo(rt).rating).toBe(5);
    expect(rt.store.getState().ai.previewing).toBe(false);
    expect(rt.history.entries).toHaveLength(1);
    expect(rt.history.getSnapshot().undoLabel).toBe("AI: Best photos, brighter");
    await rt.dispatch("history.undo");
    expect(photo(rt).rating).toBe(0);
    expect(photo(rt).edit).toBeUndefined();
  });

  it("a failing step rolls the whole plan back", async () => {
    const { rt } = await runtimeWithAi();
    await expect(rt.plans.apply([steps[0]!, { actionId: "library.rating.set", params: { rating: 9 } }], "bad")).rejects.toThrow(/Step 2/);
    expect(photo(rt).rating).toBe(0);
    expect(rt.history.canUndo).toBe(false);
  });

  it("previews are never persisted; applied plans are", async () => {
    const { rt, library } = await runtimeWithAi();
    const source = new MemorySource({ id: "f", name: "F", kind: "memory", writable: true }, { "A.jpg": "a" });
    library.nextPick = source;
    await rt.dispatch("library.folder.open");
    const sync = new MetadataSync(rt.store, rt.services, { debounceMs: 1 });
    sync.start();
    const plan = [{ actionId: "library.rating.set", params: { rating: 3 } }];
    await rt.plans.preview(plan);
    await sync.flush();
    await rt.plans.endPreview();
    await sync.flush();
    expect(source.writes).toBe(0);
    await rt.plans.apply(plan, "rate");
    await sync.flush();
    expect(source.writes).toBe(1);
  });
});

describe("AnthropicProvider", () => {
  /** A minimal Messages API response. */
  const message = (content: unknown[], stop_reason: string) => ({
    id: `msg_${Math.random()}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  });

  function mockFetch(responses: unknown[]) {
    const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      calls.push({ url: String(url), headers, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(responses[calls.length - 1]), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  it("plans with tool lookups, caching, structured output and refusal fallback", async () => {
    const plan: Plan = { summary: "Pick the 4-star ones.", steps: [] };
    const { fetchImpl, calls } = mockFetch([
      message([{ type: "tool_use", id: "toolu_1", name: "library_photos_list", input: { minRating: 4 } }], "tool_use"),
      message([{ type: "text", text: JSON.stringify({ summary: plan.summary, steps: [{ actionId: "library.flag.set", paramsJson: '{"flag":"pick","photoIds":["A.jpg"]}', reason: "4 stars" }] }) }], "end_turn"),
    ]);
    const settings = new MemorySettingsStore();
    const provider = new AnthropicProvider(settings, fetchImpl);
    await provider.configure({ apiKey: "sk-ant-test-key" });
    const toolCalls: unknown[] = [];
    const result = await provider.propose({
      prompt: "pick my 4 star photos",
      manifest: { actions: [] },
      context: { photoCount: 1 },
      tools: [{ actionId: "library.photos.list", description: "List photos", inputSchema: { type: "object", properties: { minRating: { type: "integer" } } } }],
      callTool: async (id, input) => (toolCalls.push([id, input]), { total: 1, photos: [{ id: "A.jpg", rating: 4 }] }),
    });

    expect(result).toEqual({ summary: plan.summary, steps: [{ actionId: "library.flag.set", params: { flag: "pick", photoIds: ["A.jpg"] }, reason: "4 stars" }] });
    expect(toolCalls).toEqual([["library.photos.list", { minRating: 4 }]]);
    expect(calls).toHaveLength(2);
    const first = calls[0]!;
    expect(first.url).toContain("/v1/messages");
    expect(first.headers["x-api-key"]).toBe("sk-ant-test-key");
    expect(first.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(first.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(first.body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "medium", format: { type: "json_schema" } } });
    expect((first.body.system as Array<{ cache_control?: unknown }>)[1]!.cache_control).toEqual({ type: "ephemeral" });
    expect((first.body.tools as Array<{ name: string }>)[0]!.name).toBe("library_photos_list");
    // The tool result went back in the second request.
    const second = calls[1]!.body.messages as Array<{ role: string; content: Array<{ type: string; tool_use_id?: string }> }>;
    expect(second.at(-1)!.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
  });

  it("sends viewed photos to Claude as image content", async () => {
    const { fetchImpl, calls } = mockFetch([
      message([{ type: "tool_use", id: "toolu_v", name: "library_photos_view", input: { photoIds: ["A.jpg"] } }], "tool_use"),
      message([{ type: "text", text: JSON.stringify({ summary: "Sharp enough.", steps: [] }) }], "end_turn"),
    ]);
    const provider = new AnthropicProvider(new MemorySettingsStore(), fetchImpl);
    await provider.configure({ apiKey: "sk-ant-x" });
    await provider.propose({
      prompt: "check focus",
      manifest: {},
      context: {},
      tools: [{ actionId: "library.photos.view", description: "View", inputSchema: { type: "object", properties: {} } }],
      callTool: async () => ({ kind: "images", images: [{ photoId: "A.jpg", mediaType: "image/jpeg", data: "QUJD", width: 1024, height: 683, edited: true }] }),
    });
    const last = (calls[1]!.body.messages as Array<{ content: Array<{ type: string; content?: Array<Record<string, unknown>> }> }>).at(-1)!;
    const result = last.content[0]!;
    expect(result.type).toBe("tool_result");
    expect(result.content![0]).toMatchObject({ type: "text", text: expect.stringContaining("A.jpg (1024×683, with current edits)") });
    expect(result.content![1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } });
  });

  it("reports refusals and never echoes the key in errors", async () => {
    const { fetchImpl } = mockFetch([message([], "refusal")]);
    const provider = new AnthropicProvider(new MemorySettingsStore(), fetchImpl);
    await provider.configure({ apiKey: "sk-ant-secret" });
    await expect(provider.propose({ prompt: "x", manifest: {}, context: {}, tools: [], callTool: async () => null })).rejects.toThrow(/declined/);

    const failing = (async () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key sk-ant-secret" } }), { status: 401, headers: { "content-type": "application/json" } })) as typeof fetch;
    const p2 = new AnthropicProvider(new MemorySettingsStore(), failing);
    await p2.configure({ apiKey: "sk-ant-secret" });
    const err = await p2.propose({ prompt: "x", manifest: {}, context: {}, tools: [], callTool: async () => null }).catch((e: Error) => e.message);
    expect(err).toMatch(/rejected/);
    expect(err).not.toContain("sk-ant-secret");
  });

  it("stores the key and model locally and can remove the key", async () => {
    const settings = new MemorySettingsStore();
    const provider = new AnthropicProvider(settings);
    await provider.configure({ apiKey: "  sk-ant-x  ", model: "claude-sonnet-5-5" });
    const again = new AnthropicProvider(settings);
    await again.load();
    expect(again.isConfigured()).toBe(true);
    expect(again.model).toBe("claude-sonnet-5-5");
    await again.configure({ apiKey: null });
    expect(await settings.get("ai.apiKey")).toBeUndefined();
  });
});
