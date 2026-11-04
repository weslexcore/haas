import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { WebGL2Renderer } from "../../adapters/render/webgl2-renderer";
import { cropOutputSize, type Size } from "../../core/develop/crop";
import type { Histogram } from "../../core/develop/pipeline";
import { DEFAULT_CROP, defaultRecipe, type EditRecipe } from "../../core/develop/recipe";
import type { PhotoRecord } from "../../core/state/types";
import { useRuntime } from "../runtime-context";
import { PREVIEW_EDGE, editingBitmap } from "./bitmaps";
import styles from "./DevelopCanvas.module.css";

interface DevelopCanvasProps {
  photo: PhotoRecord;
  /** Show the unedited photo (before/after). */
  original?: boolean;
  /** Show the whole straightened frame, for the crop tool. */
  ignoreCrop?: boolean;
  /** "actual": one image pixel per device pixel, at full resolution (scrolls). */
  scale?: "fit" | "actual";
  onHistogram?: (h: Histogram) => void;
  /** Rendered over the image, sized to it (e.g. the crop overlay). Receives the displayed size in CSS px. */
  overlay?: (display: Size) => ReactNode;
  onContextMenu?: (e: React.MouseEvent) => void;
}

/**
 * The edited photo, rendered live on the GPU. Re-renders on every settings
 * change (once per animation frame) and reports a histogram.
 */
export function DevelopCanvas({ photo, original = false, ignoreCrop = false, scale = "fit", onHistogram, overlay, onContextMenu }: DevelopCanvasProps) {
  const { services } = useRuntime();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGL2Renderer | null>(null);
  const [box, setBox] = useState<Size>({ width: 0, height: 0 });
  const [source, setSource] = useState<{ id: string; size: Size } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recipe = photo.edit ?? DEFAULT_RECIPE;
  const histogramRef = useRef(onHistogram);
  histogramRef.current = onHistogram;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ width: e!.contentRect.width, height: e!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    try {
      rendererRef.current = new WebGL2Renderer(canvasRef.current!);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Load the photo into the GPU (preview size, or full size for 100%).
  const maxEdge = scale === "actual" ? undefined : PREVIEW_EDGE;
  useEffect(() => {
    let live = true;
    void editingBitmap(services.previews, photo, maxEdge).then((bitmap) => {
      const renderer = rendererRef.current;
      if (!live || !renderer) return;
      if (!bitmap) return setError(`This browser can't display ${photo.fileName}.`);
      try {
        renderer.setSource(bitmap, { width: bitmap.width, height: bitmap.height });
        setError(null);
        setSource({ id: photo.id, size: { width: bitmap.width, height: bitmap.height } });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
    return () => {
      live = false;
    };
    // The file, not the record: rating or edit changes must not reload the image.
  }, [photo.id, photo.lastModified, maxEdge, services]);

  // Displayed size: the output's aspect ratio, fitted to the container (or actual pixels).
  const ready = source?.id === photo.id;
  const crop = original ? DEFAULT_CROP : ignoreCrop ? { ...DEFAULT_CROP, angle: recipe.crop.angle } : recipe.crop;
  const output = ready ? cropOutputSize(source.size, crop) : null;
  const dpr = window.devicePixelRatio || 1;
  // Room around the photo in the crop tool, to drag there to rotate.
  const pad = ignoreCrop ? CROP_MARGIN : 0;
  let display: Size = { width: 0, height: 0 };
  let backing: Size = { width: 1, height: 1 };
  if (output) {
    if (scale === "actual") {
      display = { width: output.width / dpr, height: output.height / dpr };
      backing = output;
    } else if (box.width > 2 * pad && box.height > 2 * pad) {
      const s = Math.min((box.width - 2 * pad) / output.width, (box.height - 2 * pad) / output.height);
      display = { width: output.width * s, height: output.height * s };
      backing = {
        width: Math.max(1, Math.min(output.width, Math.round(display.width * dpr))),
        height: Math.max(1, Math.min(output.height, Math.round(display.height * dpr))),
      };
    }
  }

  // Render once per frame after any change.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !ready || display.width === 0) return;
    const frame = requestAnimationFrame(() => {
      const opts = { original, ignoreCrop, width: backing.width, height: backing.height };
      renderer.render(recipe, opts);
      // The histogram always describes the final (cropped) image, even while the crop tool shows the whole frame.
      if (histogramRef.current) histogramRef.current(renderer.histogram(recipe, { original }));
    });
    return () => cancelAnimationFrame(frame);
  }, [recipe, original, ignoreCrop, ready, backing.width, backing.height, display.width]);

  return (
    <div ref={containerRef} className={`${styles.container} ${scale === "actual" ? styles.actual : ""}`} onContextMenu={onContextMenu} data-photo-id={photo.id}>
      {error && <p className={styles.message}>{error}</p>}
      <div className={styles.frame} style={{ width: display.width, height: display.height, visibility: ready && !error ? "visible" : "hidden" }}>
        <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label={`${photo.fileName}${original ? " (before)" : ""}`} />
        {ready && overlay?.(display)}
      </div>
    </div>
  );
}

const DEFAULT_RECIPE: EditRecipe = defaultRecipe();
/** Must match the rotate zone in CropOverlay.module.css. */
const CROP_MARGIN = 40;
