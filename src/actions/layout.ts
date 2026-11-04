import { z } from "zod";
import type { AppContext } from "../core/actions/types";
import { defineAction } from "../core/actions/types";
import { LAYOUT_LIMITS, clampFloat, clampLayoutValue, initialLayout, type LayoutState } from "../core/state/layout";

export const LAYOUT_SETTINGS_KEY = "view.layout";

const sideSchema = z.enum(["left", "right"]);
const sideName = (side: "left" | "right") => (side === "left" ? "Left" : "Right");

function persistLayout(ctx: AppContext): Promise<void> {
  return ctx.services.settings.set(LAYOUT_SETTINGS_KEY, ctx.state.layout);
}

export const setPanelSide = defineAction({
  id: "view.panel.side.set",
  title: "Move Develop Panel to Side",
  description:
    "Dock the Develop controls panel to the left or right edge of the window. If the panel is floating, this docks it. The choice is remembered.",
  category: "View",
  kind: "command",
  sideEffects: true,
  params: z.object({ side: sideSchema.describe("Window edge to dock the panel to.") }),
  examples: [{ params: { side: "left" }, description: "Put the Develop panel on the left." }],
  label: ({ side }) => `Develop Panel: ${sideName(side)}`,
  async run({ side }, ctx) {
    ctx.update((s) => {
      s.layout.panelSide = side;
      s.layout.panelDocked = true;
    });
    await persistLayout(ctx);
  },
});

export const togglePanelSide = defineAction({
  id: "view.panel.side.toggle",
  title: "Move Develop Panel to Other Side",
  description: "Swap the Develop controls panel between the left and right edges of the window (docking it first if it is floating).",
  category: "View",
  kind: "command",
  sideEffects: true,
  defaultShortcuts: [{ keys: "shift+f7" }],
  async run(_, ctx) {
    const r = await ctx.dispatch(setPanelSide.id, { side: ctx.state.layout.panelSide === "left" ? "right" : "left" });
    if (!r.ok) throw new Error(r.message);
  },
});

export const undockPanel = defineAction({
  id: "view.panel.undock",
  title: "Undock Develop Panel",
  description:
    "Detach the Develop controls panel so it floats over the photo and can be dragged anywhere. Optionally say where to put it (viewport pixels). Dock it again with view.panel.dock.",
  category: "View",
  kind: "command",
  sideEffects: true,
  params: z
    .object({
      x: z.number().optional().describe("Left edge of the floating panel, px from the window's left."),
      y: z.number().optional().describe("Top edge of the floating panel, px from the window's top."),
    })
    .optional(),
  examples: [
    { params: undefined, description: "Float the panel where it last floated." },
    { params: { x: 40, y: 80 }, description: "Float the panel near the top-left corner." },
  ],
  async run(params, ctx) {
    ctx.update((s) => {
      s.layout.panelDocked = false;
      s.layout.panelFloat = clampFloat({ ...s.layout.panelFloat, x: params?.x ?? s.layout.panelFloat.x, y: params?.y ?? s.layout.panelFloat.y });
    });
    await persistLayout(ctx);
  },
});

export const dockPanel = defineAction({
  id: "view.panel.dock",
  title: "Dock Develop Panel",
  description: "Attach the floating Develop controls panel back to a window edge: the given side, or the side it was last docked to.",
  category: "View",
  kind: "command",
  sideEffects: true,
  params: z.object({ side: sideSchema.optional().describe("Edge to dock to. Omit to use the previous side.") }).optional(),
  examples: [
    { params: undefined, description: "Dock the panel where it was." },
    { params: { side: "left" }, description: "Dock the panel on the left." },
  ],
  async run(params, ctx) {
    ctx.update((s) => {
      s.layout.panelDocked = true;
      if (params?.side) s.layout.panelSide = params.side;
    });
    await persistLayout(ctx);
  },
});

export const togglePanelDock = defineAction({
  id: "view.panel.dock.toggle",
  title: "Dock / Undock Develop Panel",
  description: "Float the Develop controls panel if it is docked, or dock it back to its side if it is floating.",
  category: "View",
  kind: "command",
  sideEffects: true,
  defaultShortcuts: [{ keys: "f7" }],
  async run(_, ctx) {
    const r = await ctx.dispatch(ctx.state.layout.panelDocked ? undockPanel.id : dockPanel.id);
    if (!r.ok) throw new Error(r.message);
  },
});

export const resizePanel = defineAction({
  id: "view.panel.resize",
  title: "Resize Develop Panel",
  description: `Set the width of the docked Develop controls panel in pixels (${LAYOUT_LIMITS.panelWidth.min}–${LAYOUT_LIMITS.panelWidth.max}). Omit the width to restore the default.`,
  category: "View",
  kind: "command",
  sideEffects: true,
  params: z.object({ width: z.number().optional().describe("Panel width in px. Omit for the default width.") }).optional(),
  examples: [
    { params: { width: 380 }, description: "Make the panel 380px wide." },
    { params: undefined, description: "Restore the default panel width." },
  ],
  async run(params, ctx) {
    ctx.update((s) => {
      s.layout.panelWidth = clampLayoutValue(params?.width ?? LAYOUT_LIMITS.panelWidth.default, LAYOUT_LIMITS.panelWidth);
    });
    await persistLayout(ctx);
  },
});

export const movePanel = defineAction({
  id: "view.panel.float.set",
  title: "Move or Resize Floating Develop Panel",
  description: "Set the position and/or size of the floating Develop panel, in viewport pixels. Fields left out keep their value.",
  category: "View",
  kind: "command",
  internal: true,
  sideEffects: true,
  params: z.object({
    x: z.number().optional().describe("Left edge, px."),
    y: z.number().optional().describe("Top edge, px."),
    width: z.number().optional().describe("Width, px."),
    height: z.number().optional().describe("Height, px."),
  }),
  examples: [{ params: { x: 100, y: 120 }, description: "Move the floating panel." }],
  async run(params, ctx) {
    ctx.update((s) => {
      s.layout.panelFloat = clampFloat({ ...s.layout.panelFloat, ...params });
    });
    await persistLayout(ctx);
  },
});

export const resizeFilmstrip = defineAction({
  id: "view.filmstrip.resize",
  title: "Resize Filmstrip",
  description: `Set the height of the filmstrip below the photo in Loupe and Develop, in pixels (${LAYOUT_LIMITS.filmstripHeight.min}–${LAYOUT_LIMITS.filmstripHeight.max}). Omit the height to restore the default.`,
  category: "View",
  kind: "command",
  sideEffects: true,
  params: z.object({ height: z.number().optional().describe("Filmstrip height in px. Omit for the default height.") }).optional(),
  examples: [
    { params: { height: 160 }, description: "Show bigger filmstrip thumbnails." },
    { params: undefined, description: "Restore the default filmstrip height." },
  ],
  async run(params, ctx) {
    ctx.update((s) => {
      s.layout.filmstripHeight = clampLayoutValue(params?.height ?? LAYOUT_LIMITS.filmstripHeight.default, LAYOUT_LIMITS.filmstripHeight);
    });
    await persistLayout(ctx);
  },
});

const floatSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

export const restoreLayout = defineAction({
  id: "view.layout.restore",
  title: "Restore Saved Layout",
  description: "Startup plumbing: applies the remembered panel and filmstrip layout. Unknown or out-of-range values fall back to the defaults.",
  category: "View",
  kind: "command",
  internal: true,
  params: z.object({
    layout: z
      .object({
        panelSide: sideSchema.optional(),
        panelWidth: z.number().optional(),
        panelDocked: z.boolean().optional(),
        panelFloat: floatSchema.optional(),
        filmstripHeight: z.number().optional(),
      })
      .describe("Saved layout, possibly partial."),
  }),
  examples: [{ params: { layout: { panelSide: "left", panelWidth: 320 } }, description: "Panel on the left, 320px wide." }],
  run({ layout }, ctx) {
    const next: LayoutState = {
      panelSide: layout.panelSide ?? initialLayout.panelSide,
      panelWidth: clampLayoutValue(layout.panelWidth ?? initialLayout.panelWidth, LAYOUT_LIMITS.panelWidth),
      panelDocked: layout.panelDocked ?? initialLayout.panelDocked,
      panelFloat: clampFloat(layout.panelFloat ?? initialLayout.panelFloat),
      filmstripHeight: clampLayoutValue(layout.filmstripHeight ?? initialLayout.filmstripHeight, LAYOUT_LIMITS.filmstripHeight),
    };
    ctx.update((s) => {
      s.layout = next;
    });
  },
});

export const layoutActions = [setPanelSide, togglePanelSide, undockPanel, dockPanel, togglePanelDock, resizePanel, movePanel, resizeFilmstrip, restoreLayout];
