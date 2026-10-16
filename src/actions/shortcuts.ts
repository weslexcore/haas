import { z } from "zod";
import { defineAction, type AppContext } from "../core/actions/types";

function requireAction(ctx: AppContext, actionId: string) {
  const action = ctx.registry.get(actionId);
  if (!action) throw new Error(`No action with id "${actionId}".`);
  return action;
}

export const bindShortcut = defineAction({
  id: "app.shortcuts.bind",
  title: "Assign Shortcut",
  description:
    "Bind a key combo to an action, optionally with fixed params. Adds a new binding, or replaces the keys of " +
    "binding number `replaceIndex`. Keys use `mod` for Cmd/Ctrl and spaces for chords. Saved as a user override.",
  category: "App",
  kind: "command",
  params: z.object({
    actionId: z.string().describe("The action to bind."),
    keys: z.string().min(1).describe('Key combo, e.g. "mod+shift+e" or "g d" (a chord).'),
    params: z.unknown().optional().describe("Fixed params to dispatch with this binding."),
    replaceIndex: z.number().int().min(0).optional().describe("Replace the keys of this existing binding instead of adding one."),
  }),
  examples: [
    { params: { actionId: "view.set", keys: "shift+g", params: { view: "grid" } }, description: "Also open the grid with Shift+G." },
    { params: { actionId: "history.redo", keys: "mod+y", replaceIndex: 0 }, description: "Use Mod+Y for redo instead of the default." },
  ],
  run({ actionId, keys, params, replaceIndex }, ctx) {
    const action = requireAction(ctx, actionId);
    if (params !== undefined) {
      const r = action.params?.safeParse(params);
      if (!r?.success) throw new Error(`Params are not valid for "${actionId}".`);
    }
    if (replaceIndex !== undefined) ctx.keybindings.replaceKeys(actionId, replaceIndex, keys);
    else ctx.keybindings.addBinding(actionId, keys, params);
  },
});

export const unbindShortcut = defineAction({
  id: "app.shortcuts.unbind",
  title: "Remove Shortcut",
  description: "Remove binding number `index` from an action's shortcut list (see the shortcut list for indexes).",
  category: "App",
  kind: "command",
  params: z.object({
    actionId: z.string().describe("The action whose binding to remove."),
    index: z.number().int().min(0).describe("Position of the binding in the action's list, starting at 0."),
  }),
  examples: [{ params: { actionId: "app.theme.toggle", index: 0 }, description: "Remove the theme toggle's chord." }],
  run({ actionId, index }, ctx) {
    requireAction(ctx, actionId);
    ctx.keybindings.removeBinding(actionId, index);
  },
});

export const resetShortcuts = defineAction({
  id: "app.shortcuts.reset",
  title: "Reset Shortcuts",
  description: "Restore default shortcuts for one action, or for every action when actionId is omitted.",
  category: "App",
  kind: "command",
  params: z
    .object({ actionId: z.string().optional().describe("Reset only this action. Omit to reset all shortcuts.") })
    .optional(),
  examples: [
    { params: { actionId: "view.set" }, description: "Restore G/E/D for the views." },
    { params: {}, description: "Reset every shortcut to its default." },
  ],
  run(params, ctx) {
    if (params?.actionId) {
      requireAction(ctx, params.actionId);
      ctx.keybindings.resetToDefault(params.actionId);
    } else {
      ctx.keybindings.resetAll();
    }
  },
});

export const exportShortcuts = defineAction({
  id: "app.shortcuts.export",
  title: "Export Shortcuts",
  description: "Download the user's custom shortcut overrides as a JSON file that can be imported elsewhere.",
  category: "App",
  kind: "command",
  run(_, ctx) {
    ctx.services.downloads.save("photo-shortcuts.json", ctx.keybindings.exportJSON(), "application/json");
  },
});

export const importShortcuts = defineAction({
  id: "app.shortcuts.import",
  title: "Import Shortcuts",
  description:
    "Replace all custom shortcut overrides with ones from an exported JSON document. Bindings for actions " +
    "that no longer exist are skipped.",
  category: "App",
  kind: "command",
  params: z.object({ json: z.string().min(2).describe("Contents of a file made by Export Shortcuts.") }),
  examples: [
    {
      params: { json: '{"version":1,"overrides":{"history.redo":[{"keys":"mod+y"}]}}' },
      description: "Import a single override.",
    },
  ],
  run({ json }, ctx) {
    return ctx.keybindings.importJSON(json);
  },
});

export const shortcutActions = [bindShortcut, unbindShortcut, resetShortcuts, exportShortcuts, importShortcuts];
