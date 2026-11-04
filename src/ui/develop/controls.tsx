import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { Histogram } from "../../core/develop/pipeline";
import styles from "./DevelopPanel.module.css";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Shown value (e.g. "+0.30"). */
  format?: (v: number) => string;
  onChange: (value: number) => void;
  /** Gradient behind the track (e.g. blue→yellow for temperature). */
  track?: string;
  disabled?: boolean;
  /** DOM id, when the label isn't unique in the panel. */
  id?: string;
  /** Value restored by double-click (default 0). */
  resetValue?: number;
}

/** A collapsible panel section, with an optional control (e.g. Reset) in its header. */
export function Section({ title, children, defaultOpen = true, action }: { title: string; children: ReactNode; defaultOpen?: boolean; action?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  // Opens again whenever defaultOpen turns on (e.g. Crop & Straighten when the crop tool starts).
  const [wasDefaultOpen, setWasDefaultOpen] = useState(defaultOpen);
  if (defaultOpen !== wasDefaultOpen) {
    setWasDefaultOpen(defaultOpen);
    if (defaultOpen) setOpen(true);
  }
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <button type="button" className={styles.sectionToggle} aria-expanded={open} onClick={() => setOpen(!open)}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> {title}
        </button>
        {action}
      </div>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </section>
  );
}

/** Range slider: drag, arrow keys, or double-click the label to reset (to 0 unless resetValue is given). */
export function Slider({ label, value, min, max, step, format, onChange, track, disabled, id: givenId, resetValue = 0 }: SliderProps) {
  const id = givenId ?? `slider-${label.replace(/\W+/g, "-").toLowerCase()}`;
  const shown = format ? format(value) : value > 0 ? `+${value}` : String(value);
  return (
    <div className={styles.slider}>
      <label htmlFor={id} className={styles.sliderLabel} onDoubleClick={() => onChange(resetValue)} title="Double-click to reset">
        {label}
      </label>
      <output htmlFor={id} className={`${styles.sliderValue} ${value !== resetValue ? styles.changed : ""}`}>
        {shown}
      </output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        className={styles.range}
        style={track ? ({ "--track": track } as CSSProperties) : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(resetValue)}
      />
    </div>
  );
}

/** Luminance + RGB histogram, with clipping indicators. */
export function HistogramView({ histogram }: { histogram: Histogram | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = (canvas.width = 256);
    const h = (canvas.height = 100);
    ctx.clearRect(0, 0, w, h);
    if (!histogram) return;
    // Ignore the extreme bins when scaling, so clipping spikes don't flatten everything else.
    let peak = 1;
    for (const ch of [histogram.r, histogram.g, histogram.b]) for (let i = 2; i < 254; i++) peak = Math.max(peak, ch[i]!);
    ctx.globalCompositeOperation = "lighter";
    const draw = (data: Uint32Array, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < 256; i++) ctx.lineTo(i, h - Math.min(1, data[i]! / peak) * h);
      ctx.lineTo(255, h);
      ctx.fill();
    };
    draw(histogram.r, "rgb(220 60 60 / 0.75)");
    draw(histogram.g, "rgb(60 200 80 / 0.75)");
    draw(histogram.b, "rgb(70 110 240 / 0.75)");
    ctx.globalCompositeOperation = "source-over";
  }, [histogram]);

  const pct = (n: number) => (histogram && histogram.total ? (n / histogram.total) * 100 : 0);
  const shadows = histogram ? pct(histogram.clippedShadows) : 0;
  const highlights = histogram ? pct(histogram.clippedHighlights) : 0;
  return (
    <div className={styles.histogram}>
      <canvas ref={ref} className={styles.histogramCanvas} role="img" aria-label="Histogram" />
      <div className={styles.clipping}>
        <span className={shadows > 0.5 ? styles.clipWarn : ""} title="Pure black pixels">◀ {shadows.toFixed(1)}%</span>
        <span className={highlights > 0.5 ? styles.clipWarn : ""} title="Pixels clipped in any channel">{highlights.toFixed(1)}% ▶</span>
      </div>
    </div>
  );
}

interface CurveEditorProps {
  points: Array<[number, number]>;
  onChange: (points: Array<[number, number]>) => void;
  curve: (x: number) => number;
}

/**
 * Tone curve editor. Drag points; click empty space to add one; double-click
 * a point (or select it and press Delete) to remove it. Arrow keys nudge.
 */
export function CurveEditor({ points, onChange, curve }: CurveEditorProps) {
  const ref = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const selected = useRef<number | null>(null);
  const SIZE = 200;
  const toSvg = ([x, y]: [number, number]) => [x * SIZE, (1 - y) * SIZE] as const;

  const fromEvent = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  };

  const move = (i: number, [x, y]: [number, number]) => {
    const next = points.map((p) => [...p] as [number, number]);
    const lo = i === 0 ? 0 : next[i - 1]![0] + 0.01;
    const hi = i === next.length - 1 ? 1 : next[i + 1]![0] - 0.01;
    // End points stay at x = 0 and x = 1.
    next[i] = [i === 0 ? 0 : i === next.length - 1 ? 1 : Math.min(hi, Math.max(lo, x)), y];
    onChange(next);
  };

  const path = Array.from({ length: 65 }, (_, k) => {
    const x = k / 64;
    const [sx, sy] = toSvg([x, Math.min(1, Math.max(0, curve(x)))]);
    return `${k ? "L" : "M"}${sx.toFixed(1)},${sy.toFixed(1)}`;
  }).join(" ");

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const i = selected.current;
    if (i === null) return;
    const p = points[i]!;
    const d = e.shiftKey ? 0.05 : 0.01;
    const nudge: Record<string, [number, number]> = { ArrowUp: [0, d], ArrowDown: [0, -d], ArrowLeft: [-d, 0], ArrowRight: [d, 0] };
    if (nudge[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      move(i, [p[0] + nudge[e.key]![0], Math.min(1, Math.max(0, p[1] + nudge[e.key]![1]))]);
    } else if ((e.key === "Delete" || e.key === "Backspace") && i > 0 && i < points.length - 1) {
      e.preventDefault();
      e.stopPropagation();
      selected.current = null;
      onChange(points.filter((_, k) => k !== i));
    }
  };

  return (
    <svg
      ref={ref}
      viewBox={`-4 -4 ${SIZE + 8} ${SIZE + 8}`}
      className={styles.curve}
      tabIndex={0}
      role="application"
      aria-label="Tone curve editor. Click to add a point, drag to move, double-click to remove; arrow keys nudge the selected point."
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if ((e.target as Element).getAttribute("data-point") !== null) return;
        const p = fromEvent(e);
        if (points.length >= 16) return;
        const next = [...points, p].sort((a, b) => a[0] - b[0]);
        const i = next.indexOf(p);
        if (i === 0 || i === next.length - 1) return;
        onChange(next);
        dragging.current = i;
        selected.current = i;
        (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => dragging.current !== null && move(dragging.current, fromEvent(e))}
      onPointerUp={() => (dragging.current = null)}
    >
      {[0.25, 0.5, 0.75].map((g) => (
        <g key={g} className={styles.curveGrid}>
          <line x1={g * SIZE} y1={0} x2={g * SIZE} y2={SIZE} />
          <line x1={0} y1={g * SIZE} x2={SIZE} y2={g * SIZE} />
        </g>
      ))}
      <rect x={0} y={0} width={SIZE} height={SIZE} className={styles.curveFrame} />
      <line x1={0} y1={SIZE} x2={SIZE} y2={0} className={styles.curveDiagonal} />
      <path d={path} className={styles.curvePath} />
      {points.map((p, i) => {
        const [cx, cy] = toSvg(p);
        return (
          <circle
            key={i}
            data-point={i}
            cx={cx}
            cy={cy}
            r={5}
            className={styles.curvePoint}
            onPointerDown={(e) => {
              e.stopPropagation();
              dragging.current = i;
              selected.current = i;
              ref.current!.setPointerCapture(e.pointerId);
              ref.current!.focus();
            }}
            onDoubleClick={() => i > 0 && i < points.length - 1 && onChange(points.filter((_, k) => k !== i))}
          />
        );
      })}
    </svg>
  );
}
