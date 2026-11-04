import { describe, expect, it } from "vitest";
import { LAYOUT_SETTINGS_KEY } from "../../src/actions/layout";
import { LAYOUT_LIMITS, initialLayout } from "../../src/core/state/layout";
import { createTestRuntime } from "./helpers";

describe("layout actions", () => {
  it("starts with the panel docked on the right at the default sizes", async () => {
    const rt = await createTestRuntime({ loadSample: false });
    expect(rt.store.getState().layout).toEqual(initialLayout);
  });

  it("moves the panel between sides and remembers it", async () => {
    const rt = await createTestRuntime({ loadSample: false });
    expect((await rt.dispatch("view.panel.side.set", { side: "left" })).ok).toBe(true);
    expect(rt.store.getState().layout.panelSide).toBe("left");
    await rt.dispatch("view.panel.side.toggle");
    expect(rt.store.getState().layout.panelSide).toBe("right");
    expect(await rt.services.settings.get(LAYOUT_SETTINGS_KEY)).toMatchObject({ panelSide: "right" });
  });

  it("undocks, floats at a position, and docks back (optionally to the other side)", async () => {
    const rt = await createTestRuntime({ loadSample: false });
    await rt.dispatch("view.panel.undock", { x: 120, y: 60 });
    let layout = rt.store.getState().layout;
    expect(layout.panelDocked).toBe(false);
    expect(layout.panelFloat).toMatchObject({ x: 120, y: 60 });

    await rt.dispatch("view.panel.float.set", { x: -50, width: 10, height: 5000 });
    layout = rt.store.getState().layout;
    expect(layout.panelFloat.x).toBe(0);
    expect(layout.panelFloat.width).toBe(LAYOUT_LIMITS.floatWidth.min);
    expect(layout.panelFloat.height).toBe(LAYOUT_LIMITS.floatHeight.max);

    await rt.dispatch("view.panel.dock", { side: "left" });
    layout = rt.store.getState().layout;
    expect(layout.panelDocked).toBe(true);
    expect(layout.panelSide).toBe("left");

    await rt.dispatch("view.panel.dock.toggle");
    expect(rt.store.getState().layout.panelDocked).toBe(false);
    await rt.dispatch("view.panel.dock.toggle");
    expect(rt.store.getState().layout.panelDocked).toBe(true);

    // Choosing a side while floating docks the panel there.
    await rt.dispatch("view.panel.undock");
    await rt.dispatch("view.panel.side.set", { side: "right" });
    expect(rt.store.getState().layout).toMatchObject({ panelDocked: true, panelSide: "right" });
  });

  it("clamps panel and filmstrip sizes, and resets to the defaults without a value", async () => {
    const rt = await createTestRuntime({ loadSample: false });
    await rt.dispatch("view.panel.resize", { width: 5000 });
    expect(rt.store.getState().layout.panelWidth).toBe(LAYOUT_LIMITS.panelWidth.max);
    await rt.dispatch("view.panel.resize", { width: 1 });
    expect(rt.store.getState().layout.panelWidth).toBe(LAYOUT_LIMITS.panelWidth.min);
    await rt.dispatch("view.panel.resize");
    expect(rt.store.getState().layout.panelWidth).toBe(LAYOUT_LIMITS.panelWidth.default);

    await rt.dispatch("view.filmstrip.resize", { height: 150.6 });
    expect(rt.store.getState().layout.filmstripHeight).toBe(151);
    await rt.dispatch("view.filmstrip.resize", { height: 0 });
    expect(rt.store.getState().layout.filmstripHeight).toBe(LAYOUT_LIMITS.filmstripHeight.min);
    await rt.dispatch("view.filmstrip.resize");
    expect(rt.store.getState().layout.filmstripHeight).toBe(LAYOUT_LIMITS.filmstripHeight.default);
  });

  it("sets, steps and clamps the grid thumbnail size; stepping is only for Grid", async () => {
    const rt = await createTestRuntime({ loadSample: false });
    const grid = LAYOUT_LIMITS.gridCellWidth;
    expect(rt.store.getState().layout.gridCellWidth).toBe(grid.default);
    await rt.dispatch("view.grid.size.set", { width: 9999 });
    expect(rt.store.getState().layout.gridCellWidth).toBe(grid.max);
    await rt.dispatch("view.grid.size.set");
    expect(rt.store.getState().layout.gridCellWidth).toBe(grid.default);

    expect((await rt.dispatch("view.grid.size.step", { direction: "larger" })).ok).toBe(true);
    expect(rt.store.getState().layout.gridCellWidth).toBe(grid.default + grid.step);
    await rt.dispatch("view.grid.size.step", { direction: "smaller" });
    await rt.dispatch("view.grid.size.step", { direction: "smaller" });
    expect(rt.store.getState().layout.gridCellWidth).toBe(grid.default - grid.step);
    await rt.dispatch("view.grid.size.set", { width: grid.min });
    await rt.dispatch("view.grid.size.step", { direction: "smaller" });
    expect(rt.store.getState().layout.gridCellWidth).toBe(grid.min);
    expect(await rt.services.settings.get(LAYOUT_SETTINGS_KEY)).toMatchObject({ gridCellWidth: grid.min });

    await rt.dispatch("view.set", { view: "loupe" });
    expect((await rt.dispatch("view.grid.size.step", { direction: "larger" })).ok).toBe(false);
    expect(rt.store.getState().layout.gridCellWidth).toBe(grid.min);
  });

  it("sizes are not undo steps", async () => {
    const rt = await createTestRuntime({ loadSample: false });
    await rt.dispatch("view.panel.resize", { width: 400 });
    await rt.dispatch("view.filmstrip.resize", { height: 150 });
    await rt.dispatch("view.grid.size.step", { direction: "larger" });
    expect(rt.history.canUndo).toBe(false);
  });

  it("restores a saved layout, filling gaps and clamping bad values", async () => {
    const rt = await createTestRuntime({ loadSample: false });
    const r = await rt.dispatch("view.layout.restore", {
      layout: { panelSide: "left", panelWidth: 9999, panelDocked: false, panelFloat: { x: 10, y: 20, width: 300, height: 400 } },
    });
    expect(r.ok).toBe(true);
    expect(rt.store.getState().layout).toEqual({
      panelSide: "left",
      panelWidth: LAYOUT_LIMITS.panelWidth.max,
      panelDocked: false,
      panelFloat: { x: 10, y: 20, width: 300, height: 400 },
      filmstripHeight: LAYOUT_LIMITS.filmstripHeight.default,
      gridCellWidth: LAYOUT_LIMITS.gridCellWidth.default,
    });

    const bad = await rt.dispatch("view.layout.restore", { layout: { panelSide: "top" } });
    expect(bad.ok).toBe(false);
  });
});
