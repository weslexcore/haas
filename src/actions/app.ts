import { z } from "zod";
import { defineAction } from "../core/actions/types";
import { contextMenuOpen, hasPhotos, paletteOpen, shortcutsOpen, when } from "../core/actions/when";
import { buildManifest, paramsJsonSchema, serializeManifest } from "../core/manifest/build-manifest";
import { reviewPlan } from "../core/ai/plan";
import { composeMessage, historyMessages, renderReply, turnId, type AiTurn } from "../core/ai/thread";
import { renderSkillMd } from "../core/manifest/render-skill-md";
import { contextSummary } from "./context";

export const openPalette = defineAction({
  id: "app.palette.open",
  title: "Toggle Command Palette",
  description:
    "Open the command palette, a searchable list of every available action. Pass actionId to open it directly " +
    "on that action's parameter form. Running it while the palette is open (with no actionId) closes it.",
  category: "App",
  kind: "command",
  params: z
    .object({
      actionId: z.string().optional().describe("Open straight to this action's parameter step."),
    })
    .optional(),
  examples: [
    { params: {}, description: "Open the palette to search all actions." },
    { params: { actionId: "library.rating.set" }, description: "Ask the user which rating to apply." },
  ],
  defaultShortcuts: [{ keys: "mod+k", allowInInput: true }],
  run(params, ctx) {
    const actionId = params?.actionId ?? null;
    ctx.update((s) => {
      if (s.palette.open && !actionId) {
        s.palette = { open: false, actionId: null };
      } else {
        s.palette = { open: true, actionId };
        s.shortcutsOpen = false;
      }
    });
  },
});

export const closePalette = defineAction({
  id: "app.palette.close",
  title: "Close Command Palette",
  description: "Close the command palette without running anything.",
  category: "App",
  kind: "command",
  when: paletteOpen,
  run(_, ctx) {
    ctx.update((s) => {
      s.palette = { open: false, actionId: null };
    });
  },
});

export const openShortcuts = defineAction({
  id: "app.shortcuts.open",
  title: "Keyboard Shortcuts",
  description:
    "Open the Keyboard Shortcuts screen, where the user can search actions, rebind keys, resolve conflicts, " +
    "reset to defaults and import or export bindings as JSON.",
  category: "App",
  kind: "command",
  defaultShortcuts: [{ keys: "mod+/" }],
  run(_, ctx) {
    ctx.update((s) => {
      s.shortcutsOpen = true;
      s.palette = { open: false, actionId: null };
    });
  },
});

export const closeShortcuts = defineAction({
  id: "app.shortcuts.close",
  title: "Close Keyboard Shortcuts",
  description: "Close the Keyboard Shortcuts screen.",
  category: "App",
  kind: "command",
  when: shortcutsOpen,
  run(_, ctx) {
    ctx.update((s) => {
      s.shortcutsOpen = false;
    });
  },
});

const themeSchema = z.enum(["light", "dark", "system"]);
export const THEME_SETTINGS_KEY = "app.theme";

export const setTheme = defineAction({
  id: "app.theme.set",
  title: "Set Theme",
  description: "Choose the colour theme: light, dark, or follow the operating system setting. The choice is remembered.",
  category: "App",
  kind: "command",
  params: z.object({ theme: themeSchema.describe("Colour theme to use.") }),
  examples: [
    { params: { theme: "dark" }, description: "Use the dark theme." },
    { params: { theme: "system" }, description: "Follow the OS light/dark setting." },
  ],
  label: ({ theme }) => `Theme: ${theme[0]!.toUpperCase()}${theme.slice(1)}`,
  async run({ theme }, ctx) {
    ctx.update((s) => {
      s.theme = theme;
    });
    await ctx.services.settings.set(THEME_SETTINGS_KEY, theme);
  },
});

export const toggleTheme = defineAction({
  id: "app.theme.toggle",
  title: "Toggle Light/Dark Theme",
  description: "Switch between the light and dark themes, starting from whichever one is currently showing.",
  category: "App",
  kind: "command",
  defaultShortcuts: [{ keys: "t t" }],
  async run(_, ctx) {
    const current = ctx.state.theme === "system" ? (ctx.platform.prefersDark() ? "dark" : "light") : ctx.state.theme;
    const result = await ctx.dispatch(setTheme.id, { theme: current === "dark" ? "light" : "dark" });
    if (!result.ok) throw new Error(result.message);
  },
});

export const AUTO_ADVANCE_SETTINGS_KEY = "app.autoAdvance";
const AUTO_ADVANCE_LABELS = { capsLock: "Auto-Advance: When Caps Lock Is On", always: "Auto-Advance: Always", never: "Auto-Advance: Never" } as const;

export const setAutoAdvance = defineAction({
  id: "app.autoAdvance.set",
  title: "Set Auto-Advance",
  description:
    "Choose when rating, flagging or labelling a photo moves on to the next one: capsLock (only while Caps " +
    "Lock is on, as in Lightroom; the default), always, or never. Applies to keyboard, palette, menu and " +
    "button use; AI and scripts advance only when they pass advance: true. The choice is remembered.",
  category: "App",
  kind: "command",
  params: z.object({ mode: z.enum(["capsLock", "always", "never"]).describe("When to auto-advance.") }),
  examples: [
    { params: { mode: "always" }, description: "Always move to the next photo after culling." },
    { params: { mode: "capsLock" }, description: "Lightroom behaviour: only while Caps Lock is on." },
  ],
  label: ({ mode }) => AUTO_ADVANCE_LABELS[mode],
  async run({ mode }, ctx) {
    ctx.update((s) => {
      s.autoAdvance = mode;
    });
    await ctx.services.settings.set(AUTO_ADVANCE_SETTINGS_KEY, mode);
  },
});

export const openContextMenu = defineAction({
  id: "app.contextMenu.open",
  title: "Open Context Menu",
  description:
    "Open a context menu. Without menuId, opens the photo menu for the current view next to the active " +
    "photo (the keyboard equivalent of right-clicking it); that needs photos in the library. x/y place it at a " +
    "viewport position; on small screens menus open as a sheet at the bottom instead.",
  category: "App",
  kind: "command",
  params: z
    .object({
      menuId: z.string().optional().describe("Menu to open; defaults to the current view's photo menu."),
      x: z.number().optional().describe("Viewport x position in CSS pixels."),
      y: z.number().optional().describe("Viewport y position in CSS pixels."),
    })
    .optional(),
  examples: [
    { params: {}, description: "Open the photo menu for the active photo." },
    { params: { menuId: "grid.photo", x: 320, y: 240 }, description: "Open the grid photo menu at a point." },
  ],
  defaultShortcuts: [{ keys: "shift+f10" }, { keys: "contextmenu" }],
  run(params, ctx) {
    const menuId = params?.menuId ?? (ctx.state.view === "grid" ? "grid.photo" : "loupe.photo");
    if (!ctx.menus.get(menuId)) throw new Error(`No menu with id "${menuId}".`);
    if (menuId.endsWith(".photo") && !hasPhotos.test(ctx)) throw new Error("There are no photos to act on.");
    ctx.update((s) => {
      s.contextMenu = { menuId, x: params?.x ?? null, y: params?.y ?? null };
      s.palette = { open: false, actionId: null };
    });
  },
});

export const closeContextMenu = defineAction({
  id: "app.contextMenu.close",
  title: "Close Context Menu",
  description: "Close the open context menu without running anything.",
  category: "App",
  kind: "command",
  when: contextMenuOpen,
  run(_, ctx) {
    ctx.update((s) => {
      s.contextMenu = null;
    });
  },
});

export const getContext = defineAction({
  id: "app.context.get",
  title: "Get App Context",
  description:
    "Return a summary of the current app state: view, theme, library size, selection, active photo and " +
    "undo/redo availability. Call this first to understand what the user is looking at.",
  category: "App",
  kind: "query",
  run(_, ctx) {
    return contextSummary(ctx);
  },
});

export const listActions = defineAction({
  id: "app.actions.list",
  title: "List Actions",
  description:
    "Return every registered action's id, title, category, kind and whether it is available right now. " +
    "Use availableOnly to see only what can run in the current context.",
  category: "App",
  kind: "query",
  params: z
    .object({
      category: z.enum(["App", "View", "Navigation", "Library", "Develop", "History"]).optional().describe("Only this category."),
      availableOnly: z.boolean().optional().describe("Only actions available in the current context."),
    })
    .optional(),
  examples: [
    { params: {}, description: "List all actions." },
    { params: { category: "Library", availableOnly: true }, description: "Library actions usable right now." },
  ],
  run(params, ctx) {
    return ctx.registry
      .all()
      .filter((a) => !a.internal)
      .map((a) => ({
        id: a.id,
        title: a.title,
        category: a.category,
        kind: a.kind,
        available: !a.when || a.when.test(ctx),
      }))
      .filter((a) => (!params?.category || a.category === params.category) && (!params?.availableOnly || a.available));
  },
});

export const exportManifest = defineAction({
  id: "app.manifest.export",
  title: "Export Action Manifest",
  description:
    "Download the action manifest generated from the live registry: actions.json (machine-readable, with JSON " +
    "Schemas) or SKILL.md (a readable guide for people and AI agents).",
  category: "App",
  kind: "command",
  params: z.object({
    format: z.enum(["json", "skill"]).default("json").describe("json for actions.json, skill for SKILL.md."),
  }),
  examples: [
    { params: { format: "json" }, description: "Download actions.json." },
    { params: { format: "skill" }, description: "Download SKILL.md." },
  ],
  label: ({ format }) => (format === "skill" ? "Export SKILL.md" : "Export actions.json"),
  run({ format }, ctx) {
    const manifest = buildManifest(ctx.registry, ctx.menus);
    if (format === "skill") ctx.services.downloads.save("SKILL.md", renderSkillMd(manifest), "text/markdown");
    else ctx.services.downloads.save("actions.json", serializeManifest(manifest), "application/json");
  },
});

export const askAI = defineAction({
  id: "app.ai.ask",
  title: "Ask AI",
  description:
    "Send a message to the AI in the current conversation, with the action manifest, current context and the " +
    "status of earlier suggestions. The model may run read-only queries and look at photos, then suggests a plan " +
    "that is checked against each action's schema and added to the conversation. Nothing is applied.",
  category: "App",
  kind: "command",
  internal: true,
  params: z.object({ prompt: z.string().min(1).describe("What the user wants, in their own words.") }),
  examples: [{ params: { prompt: "Show me only 4+ star photos" }, description: "Ask for a plan to filter the library." }],
  async run({ prompt }, ctx) {
    const ai = ctx.services.ai;
    const folderId = ctx.state.library.folder?.id;
    const thread = ctx.state.ai.thread;
    const context = contextSummary(ctx);
    const message = composeMessage(prompt, context, thread);
    ctx.update((s) => {
      s.ai.thread.push({ id: turnId(), role: "user", text: prompt, sent: message, at: Date.now() });
      s.ai.panelOpen = true;
    });
    const sameFolder = () => ctx.state.library.folder?.id === folderId;
    if (!ai.isConfigured()) {
      const text = "Add an Anthropic API key in AI Settings first.";
      ctx.update((s) => void s.ai.thread.push({ id: turnId(), role: "error", message: text, at: Date.now() }));
      throw new Error(text);
    }

    const queries = ctx.registry.all().filter((a) => a.kind === "query" && !a.internal);
    let plan;
    try {
      plan = await ai.propose({
        prompt,
        message,
        history: historyMessages(thread),
        manifest: buildManifest(ctx.registry, ctx.menus),
        context,
        tools: queries.map((a) => ({
          actionId: a.id,
          description: a.description,
          inputSchema: paramsJsonSchema(a) ?? { type: "object", properties: {} },
        })),
        callTool: async (actionId, input) => {
          const action = ctx.registry.get(actionId);
          if (!action || action.kind !== "query" || action.internal) throw new Error("Only read-only queries can be used while planning.");
          const empty = !input || (typeof input === "object" && Object.keys(input).length === 0);
          const r = await ctx.dispatch(actionId, empty ? undefined : input);
          if (!r.ok) throw new Error(r.message);
          return r.value;
        },
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (sameFolder()) ctx.update((s) => void s.ai.thread.push({ id: turnId(), role: "error", message: text, at: Date.now() }));
      throw error;
    }
    const steps = reviewPlan(ctx.registry, ctx, plan.steps);
    const turn = {
      id: turnId(),
      role: "assistant" as const,
      model: ai.model,
      summary: plan.summary,
      steps,
      reply: renderReply(plan.summary, plan.steps),
      status: "pending" as const,
      applied: [],
      at: Date.now(),
    };
    if (sameFolder()) ctx.update((s) => void s.ai.thread.push(turn));
    return { turnId: turn.id, summary: plan.summary, model: ai.model, steps };
  },
});

export const toggleAiPanel = defineAction({
  id: "app.ai.panel.toggle",
  title: "Toggle AI Panel",
  description: "Show or hide the AI conversation panel, which keeps every suggestion and what was applied.",
  category: "App",
  kind: "command",
  defaultShortcuts: [{ keys: "mod+j" }],
  run(_, ctx) {
    ctx.update((s) => {
      s.ai.panelOpen = !s.ai.panelOpen;
    });
  },
});

export const clearAiThread = defineAction({
  id: "app.ai.thread.clear",
  title: "New AI Conversation",
  description: "Start a new AI conversation for this folder. The previous conversation and its suggestions are discarded.",
  category: "App",
  kind: "command",
  when: when("there is an AI conversation", (ctx) => ctx.state.ai.thread.length > 0),
  run(_, ctx) {
    ctx.update((s) => {
      s.ai.thread = [];
    });
  },
});

export const setAiThread = defineAction({
  id: "app.ai.thread.set",
  title: "Load AI Conversation",
  description: "Replace the AI conversation, e.g. with the one saved for a folder when it opens.",
  category: "App",
  kind: "command",
  internal: true,
  params: z.object({ turns: z.array(z.object({ id: z.string(), role: z.enum(["user", "assistant", "error"]) }).passthrough()).describe("Saved turns.") }),
  examples: [{ params: { turns: [] }, description: "Empty conversation." }],
  run({ turns }, ctx) {
    ctx.update((s) => {
      s.ai.thread = turns as unknown as AiTurn[];
    });
  },
});

export const markSuggestion = defineAction({
  id: "app.ai.suggestion.mark",
  title: "Mark Suggestion Applied",
  description: "Record which steps of an AI suggestion were applied, with the params used. Runs inside the apply transaction so undo reverts it.",
  category: "App",
  kind: "command",
  internal: true,
  undoable: true,
  params: z.object({
    turnId: z.string().describe("The suggestion's turn id."),
    applied: z.array(z.object({ index: z.number().int().min(0), params: z.unknown() })).describe("Applied steps."),
  }),
  examples: [{ params: { turnId: "t1", applied: [{ index: 0, params: { rating: 3 } }] }, description: "Step 1 applied." }],
  run({ turnId: id, applied }, ctx) {
    ctx.update((s) => {
      const turn = s.ai.thread.find((t) => t.id === id);
      if (turn?.role !== "assistant") throw new Error("Unknown suggestion.");
      turn.status = "applied";
      turn.applied = applied as Array<{ index: number; params: unknown }>;
    });
  },
});

export const dismissSuggestion = defineAction({
  id: "app.ai.suggestion.dismiss",
  title: "Dismiss Suggestion",
  description: "Mark an AI suggestion as dismissed (not wanted). The AI is told in later turns. Undoable.",
  category: "App",
  kind: "command",
  internal: true,
  undoable: true,
  params: z.object({ turnId: z.string().describe("The suggestion's turn id.") }),
  examples: [{ params: { turnId: "t1" }, description: "Dismiss a suggestion." }],
  run({ turnId: id }, ctx) {
    ctx.update((s) => {
      const turn = s.ai.thread.find((t) => t.id === id);
      if (turn?.role === "assistant" && turn.status === "pending") turn.status = "dismissed";
    });
  },
});

const aiModel = z.enum(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);

export const openAiSettings = defineAction({
  id: "app.ai.settings.open",
  title: "AI Settings…",
  description: "Open AI settings: the Anthropic API key (stored only in this browser) and which Claude model plans requests.",
  category: "App",
  kind: "command",
  run(_, ctx) {
    ctx.update((s) => {
      s.ai.settingsOpen = true;
      s.palette = { open: false, actionId: null };
    });
  },
});

export const closeAiSettings = defineAction({
  id: "app.ai.settings.close",
  title: "Close AI Settings",
  description: "Close the AI settings screen.",
  category: "App",
  kind: "command",
  when: when("AI settings are open", (ctx) => ctx.state.ai.settingsOpen),
  run(_, ctx) {
    ctx.update((s) => {
      s.ai.settingsOpen = false;
    });
  },
});

export const configureAi = defineAction({
  id: "app.ai.configure",
  title: "Configure AI",
  description: "Store or remove the Anthropic API key and choose the model. Internal: the key never goes through AI plans.",
  category: "App",
  kind: "command",
  internal: true,
  params: z.object({
    apiKey: z.string().nullable().optional().describe("New API key, or null to remove it."),
    model: aiModel.optional().describe("Model used for planning."),
  }),
  examples: [{ params: { model: "claude-opus-5-5" }, description: "Use Claude Opus 5.5." }],
  async run(p, ctx) {
    await ctx.services.ai.configure({
      ...(p.apiKey !== undefined ? { apiKey: p.apiKey } : {}),
      ...(p.model ? { model: p.model } : {}),
    });
    return { configured: ctx.services.ai.isConfigured(), model: ctx.services.ai.model };
  },
});

export const appActions = [
  openPalette,
  closePalette,
  openShortcuts,
  closeShortcuts,
  setTheme,
  toggleTheme,
  setAutoAdvance,
  openContextMenu,
  closeContextMenu,
  getContext,
  listActions,
  exportManifest,
  askAI,
  toggleAiPanel,
  clearAiThread,
  setAiThread,
  markSuggestion,
  dismissSuggestion,
  openAiSettings,
  closeAiSettings,
  configureAi,
];
