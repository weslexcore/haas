import { defineAction, type AppContext } from "../core/actions/types";
import { hasPhotos } from "../core/actions/when";
import { selectVisibleIds } from "../core/state/selectors";

function moveTo(ctx: AppContext, index: (current: number, count: number) => number): void {
  // Moves through photos in display order (filtered and sorted), like the grid shows them.
  const order = selectVisibleIds(ctx.state);
  if (!order.length) return;
  ctx.update((s) => {
    const current = s.selection.activeId ? order.indexOf(s.selection.activeId) : -1;
    const next = order[Math.max(0, Math.min(order.length - 1, index(current, order.length)))]!;
    s.selection = { activeId: next, ids: [next] };
  });
}

export const next = defineAction({
  id: "navigation.next",
  title: "Next Photo",
  description: "Make the next visible photo active and select only it. Stays on the last photo at the end.",
  category: "Navigation",
  kind: "command",
  when: hasPhotos,
  defaultShortcuts: [{ keys: "right" }],
  run: (_, ctx) => moveTo(ctx, (i) => i + 1),
});

export const previous = defineAction({
  id: "navigation.previous",
  title: "Previous Photo",
  description: "Make the previous visible photo active and select only it. Stays on the first photo at the start.",
  category: "Navigation",
  kind: "command",
  when: hasPhotos,
  defaultShortcuts: [{ keys: "left" }],
  run: (_, ctx) => moveTo(ctx, (i) => (i < 0 ? 0 : i - 1)),
});

export const first = defineAction({
  id: "navigation.first",
  title: "First Photo",
  description: "Make the first visible photo active and select only it.",
  category: "Navigation",
  kind: "command",
  when: hasPhotos,
  defaultShortcuts: [{ keys: "home" }],
  run: (_, ctx) => moveTo(ctx, () => 0),
});

export const last = defineAction({
  id: "navigation.last",
  title: "Last Photo",
  description: "Make the last visible photo active and select only it.",
  category: "Navigation",
  kind: "command",
  when: hasPhotos,
  defaultShortcuts: [{ keys: "end" }],
  run: (_, ctx) => moveTo(ctx, (_i, count) => count - 1),
});

export const navigationActions = [next, previous, first, last];
