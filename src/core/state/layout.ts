export type PanelSide = "left" | "right";

export interface FloatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the Develop panel and the filmstrip sit, and how big they are. Remembered across sessions. */
export interface LayoutState {
  /** Window edge the Develop panel docks to. */
  panelSide: PanelSide;
  /** Docked panel width, px. */
  panelWidth: number;
  /** False while the panel floats over the photo as a movable window. */
  panelDocked: boolean;
  /** Floating panel position and size, viewport px (kept even while docked). */
  panelFloat: FloatRect;
  /** Filmstrip height in Loupe and Develop, px. */
  filmstripHeight: number;
}

export const LAYOUT_LIMITS = {
  panelWidth: { min: 220, max: 640, default: 300 },
  filmstripHeight: { min: 56, max: 360, default: 96 },
  floatWidth: { min: 240, max: 900 },
  floatHeight: { min: 200, max: 2000 },
} as const;

export const initialLayout: LayoutState = {
  panelSide: "right",
  panelWidth: LAYOUT_LIMITS.panelWidth.default,
  panelDocked: true,
  panelFloat: { x: 80, y: 80, width: 340, height: 600 },
  filmstripHeight: LAYOUT_LIMITS.filmstripHeight.default,
};

export function clampLayoutValue(value: number, limit: { min: number; max: number }): number {
  return Math.round(Math.min(limit.max, Math.max(limit.min, value)));
}

/** Clamps a floating rect to sensible sizes; position is clamped to the window by the UI. */
export function clampFloat(rect: FloatRect): FloatRect {
  return {
    x: Math.round(Math.max(0, rect.x)),
    y: Math.round(Math.max(0, rect.y)),
    width: clampLayoutValue(rect.width, LAYOUT_LIMITS.floatWidth),
    height: clampLayoutValue(rect.height, LAYOUT_LIMITS.floatHeight),
  };
}
