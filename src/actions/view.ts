import { z } from "zod";
import { defineAction } from "../core/actions/types";
import { all, hasActivePhoto, inView } from "../core/actions/when";

const VIEW_LABELS = { grid: "Grid View", loupe: "Loupe View", develop: "Develop View" } as const;

export const setView = defineAction({
  id: "view.set",
  title: "Switch View",
  description:
    "Switch the main view: grid (thumbnails for scanning and multi-select), loupe (the active photo, large, " +
    "for close review), or develop (the active photo with editing controls).",
  category: "View",
  kind: "command",
  params: z.object({ view: z.enum(["grid", "loupe", "develop"]).describe("The view to show.") }),
  examples: [
    { params: { view: "grid" }, description: "Show the thumbnail grid." },
    { params: { view: "loupe" }, description: "Review the active photo at a large size." },
  ],
  defaultShortcuts: [
    { keys: "g", params: { view: "grid" } },
    { keys: "e", params: { view: "loupe" } },
    { keys: "d", params: { view: "develop" } },
  ],
  label: ({ view }) => VIEW_LABELS[view],
  run({ view }, ctx) {
    ctx.update((s) => {
      s.view = view;
    });
  },
});

export const toggleBeforeAfter = defineAction({
  id: "view.beforeAfter.toggle",
  title: "Toggle Before/After",
  description: "In Develop, switch between showing the edited photo and the original, to compare the effect of edits.",
  category: "View",
  kind: "command",
  when: inView("develop"),
  defaultShortcuts: [{ keys: "\\" }],
  run(_, ctx) {
    ctx.update((s) => {
      s.beforeAfter = !s.beforeAfter;
    });
  },
});

export const toggleZoom = defineAction({
  id: "view.zoom.toggle",
  title: "Toggle Zoom",
  description: "In Loupe, switch between fitting the whole photo in the window and 100% (actual pixels) to check focus.",
  category: "View",
  kind: "command",
  when: all(inView("loupe"), hasActivePhoto),
  defaultShortcuts: [{ keys: "z" }],
  run(_, ctx) {
    ctx.update((s) => {
      s.zoom = s.zoom === "fit" ? "actual" : "fit";
    });
  },
});

export const toggleInfo = defineAction({
  id: "view.info.toggle",
  title: "Toggle Info Overlay",
  description: "Show or hide capture details (camera, lens, exposure, time) over the photo in Loupe and Develop.",
  category: "View",
  kind: "command",
  when: inView("loupe", "develop"),
  defaultShortcuts: [{ keys: "i" }],
  run(_, ctx) {
    ctx.update((s) => {
      s.infoOverlay = !s.infoOverlay;
    });
  },
});

export const toggleFilmstrip = defineAction({
  id: "view.filmstrip.toggle",
  title: "Toggle Filmstrip",
  description: "Show or hide the strip of thumbnails below the photo in Loupe and Develop.",
  category: "View",
  kind: "command",
  defaultShortcuts: [{ keys: "f6" }],
  run(_, ctx) {
    ctx.update((s) => {
      s.filmstrip = !s.filmstrip;
    });
  },
});

export const viewActions = [setView, toggleBeforeAfter, toggleZoom, toggleInfo, toggleFilmstrip];
