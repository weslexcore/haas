import type { Size } from "./crop";
import type { MaskBitmaps } from "./masks";
import type { Histogram } from "./pipeline";
import type { EditRecipe } from "./recipe";

/**
 * GPU renderer for develop edits. WebGL2 today (adapters/render); the
 * interface is backend-neutral so a WebGPU implementation can drop in.
 */
export interface RenderOptions {
  /** Show the unedited photo (before/after). Crop is also ignored. */
  original?: boolean;
  /** Render the whole straightened-and-uncropped frame (for the crop tool). */
  ignoreCrop?: boolean;
  /** Output size in pixels; defaults to the crop's size at source resolution. */
  width?: number;
  height?: number;
  /** Paint this mask's coverage over the image in red (the mask tool's overlay). */
  showMask?: string;
}

export interface DevelopRenderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /** Upload the (already oriented) source image. */
  setSource(image: TexImageSource, size: Size): void;
  readonly sourceSize: Size | null;
  /**
   * Upload the bitmaps of the recipe's segment masks, by mask id. A segment
   * mask without one covers nothing until it arrives. Replaces the previous set.
   */
  setMaskBitmaps(bitmaps: MaskBitmaps): void;
  /** Render into the canvas, resizing it to the output size. Returns that size. */
  render(recipe: EditRecipe, opts?: RenderOptions): Size;
  /** Read back the last render as RGBA8, top row first. */
  readPixels(): Uint8Array;
  /** Histogram of the edited image, from a small off-screen render. */
  histogram(recipe: EditRecipe, opts?: RenderOptions): Histogram;
  dispose(): void;
}
