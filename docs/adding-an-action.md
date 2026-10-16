# Adding an action

1. **Define it** in the right module under `src/actions/` (or a new module):

```ts
import { z } from "zod";
import { defineAction } from "../core/actions/types";
import { hasSelection } from "../core/actions/when";

export const setColorLabel = defineAction({
  id: "library.colorLabel.set",           // namespace.noun.verb, camelCase segments
  title: "Set Color Label",               // shown in the palette and shortcuts screen
  description:                            // written for an AI: what it does and when to use it
    "Apply a colour label to the selected photos (or specific photos by id). Use none to clear it.",
  category: "Library",
  kind: "command",                        // "query" for read-only actions
  undoable: true,                         // record in history (commands only)
  when: hasSelection,                     // availability, with a plain-language description
  params: z.object({
    label: z.enum(["none", "red", "yellow", "green", "blue", "purple"]).describe("Label to apply."),
    photoIds: z.array(z.string()).min(1).optional().describe("Photos to change. Omit to use the selection."),
  }),
  examples: [{ params: { label: "red" }, description: "Label the selection red." }],
  defaultShortcuts: [
    { keys: "6", params: { label: "red" } },
    { keys: "7", params: { label: "yellow" } },
  ],
  label: ({ label }) => (label === "none" ? "Remove Color Label" : `Label ${label}`),
  run({ label, photoIds }, ctx) {
    const ids = targetIds(ctx.state, photoIds);
    ctx.update((s) => {
      for (const id of ids) s.photos.byId[id]!.colorLabel = label;
    });
  },
});
```

2. **Register it.** Add it to the module's exported array (for example `libraryActions`). That array is spread into `allActions` in `src/actions/index.ts`.

3. **Regenerate the manifest**: `yarn manifest`, then commit `generated/actions.json` and `generated/SKILL.md`.

4. **Run `yarn verify`.** The completeness test (`tests/unit/registry.test.ts`) fails if:
   - the description is missing or very short
   - a parameterized action has no examples, or an example doesn't validate
   - a parameter has no `.describe()`
   - a default shortcut is malformed, or its params don't validate
   - default shortcuts conflict with each other

   The manifest test fails if the committed generated files are stale.

## Rules

- **No logic in components.** UI calls `dispatch(id, params)`, usually through `<ActionButton>` or `useDispatch()`. Turning raw input into params (for example, shift-click into a range of ids) is fine. The change itself belongs in an action.
- **State changes go through `ctx.update`.** Never call `store.setState` from an action. That would bypass undo.
- **Side effects go through `ctx.services`** (settings, downloads, photo source, AI). Never call browser APIs directly from `src/actions` or `src/core`.
- **Compose with `ctx.dispatch`.** An action can run other actions; they join the caller's transaction.
- **Queries must not change anything.** They can be called freely by the AI to inspect state.
- **Symbol keys use the character they produce** (`"?"`, not `"shift+/"`). Use `mod` rather than `cmd`/`ctrl`.
- **Menus.** To put an action in a right-click menu, add `item(actionId, params?)` to a menu in `src/menus/index.ts`. A test checks that every menu item refers to a public action with valid params.
- **Internal plumbing** (results of background work, etc.) can be an action with `internal: true`. It still needs a description.
- **Workflows in SKILL.md** live in `src/core/manifest/concepts.ts` and reference action ids. A workflow only appears once all of its actions exist.
