import { defineAction } from "../core/actions/types";
import { canRedo, canUndo } from "../core/actions/when";

export const undo = defineAction({
  id: "history.undo",
  title: "Undo",
  description: "Undo the most recent undoable change. A transaction (such as an applied AI plan) is undone as one step.",
  category: "History",
  kind: "command",
  when: canUndo,
  defaultShortcuts: [{ keys: "mod+z" }],
  run: (_, ctx) => ctx.historyControl.undo(),
});

export const redo = defineAction({
  id: "history.redo",
  title: "Redo",
  description: "Redo the most recently undone change.",
  category: "History",
  kind: "command",
  when: canRedo,
  defaultShortcuts: [{ keys: "mod+shift+z" }],
  run: (_, ctx) => ctx.historyControl.redo(),
});

export const historyActions = [undo, redo];
