import { useMemo, useState } from "react";
import { SEGMENT_LABELS, hasAdjustments, maskLabel } from "../../core/develop/masks";
import { HSL_BANDS, SEGMENT_TARGETS, SLIDERS, type EditRecipe, type HslBand, type Mask, type MaskShape, type MaskSliderName, type SegmentTarget } from "../../core/develop/recipe";
import { monotoneCurve } from "../../core/develop/tone-curve";
import type { PhotoRecord } from "../../core/state/types";
import { useAppState, useDispatch, useShortcut } from "../hooks";
import { ActionButton } from "../shell/ActionButton";
import { Kbd } from "../shell/Kbd";
import { CurveEditor, Section, Slider } from "./controls";
import styles from "./DevelopPanel.module.css";
import { useMaskBitmaps, useSegmentationLoading } from "./mask-bitmaps";

const TRACKS: Partial<Record<MaskSliderName, string>> = {
  temperature: "linear-gradient(90deg, #3b6fd8, #d8d8d8, #e3b23c)",
  tint: "linear-gradient(90deg, #3fae4a, #d8d8d8, #c447c4)",
  saturation: "linear-gradient(90deg, #888, #e0412f)",
  vibrance: "linear-gradient(90deg, #888, #e07b2f)",
};
const HUE_TRACK = "linear-gradient(90deg, #e5484d, #f5c542, #46a758, #3fc1c9, #3e7bfa, #d6409f, #e5484d)";
const BAND_COLORS: Record<HslBand, string> = {
  red: "#e5484d",
  orange: "#f08c2e",
  yellow: "#f5c542",
  green: "#46a758",
  aqua: "#3fc1c9",
  blue: "#3e7bfa",
  purple: "#8e4ec6",
  magenta: "#d6409f",
};
const SHAPE_ABBR: Record<MaskShape["type"], string> = { linear: "Lin", radial: "Rad", luminance: "Lum", color: "Col", segment: "AI" };

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

/**
 * The Masks section: the photo's masks, adding and drawing new ones, and
 * for the selected mask its shape, overlay and the full set of adjustments.
 */
export function MaskSection({ photo, recipe }: { photo: PhotoRecord; recipe: EditRecipe }) {
  const dispatch = useDispatch();
  const tool = useAppState((s) => s.develop.maskTool);
  const masks = recipe.masks ?? [];
  const selected = masks.find((m) => m.id === tool.selectedId) ?? null;
  const overlayShortcut = useShortcut("develop.maskOverlay.toggle");
  const { pending, errors } = useMaskBitmaps(photo, recipe);
  const loading = useSegmentationLoading();

  const onAdd = (value: string) => {
    if (!value) return;
    const [type, target] = value.split(":") as [MaskShape["type"], SegmentTarget | undefined];
    void dispatch("develop.mask.addDefault", target ? { type, target } : { type });
  };

  return (
    <Section title="Masks">
      <div className={styles.maskAdd}>
        <select className={styles.select} aria-label="Add mask" value="" onChange={(e) => onAdd(e.target.value)}>
          <option value="">Add mask…</option>
          <optgroup label="Detect">
            {SEGMENT_TARGETS.map((t) => (
              <option key={t} value={`segment:${t}`}>
                {SEGMENT_LABELS[t]}
              </option>
            ))}
          </optgroup>
          <optgroup label="Draw">
            <option value="linear">Linear gradient</option>
            <option value="radial">Radial gradient</option>
          </optgroup>
          <optgroup label="Range">
            <option value="luminance">Luminance range</option>
            <option value="color">Colour range</option>
          </optgroup>
        </select>
        <ActionButton actionId="develop.mask.draw" params={{ shape: "linear" }} className={styles.tool} aria-pressed={tool.drawing === "linear"}>
          Draw linear
        </ActionButton>
        <ActionButton actionId="develop.mask.draw" params={{ shape: "radial" }} className={styles.tool} aria-pressed={tool.drawing === "radial"}>
          Draw radial
        </ActionButton>
      </div>
      {loading && (
        <p className={styles.hint} role="status">
          Downloading the segmentation model… {mb(loading.loaded)}
          {loading.total ? ` of ${mb(loading.total)}` : ""}
        </p>
      )}
      {masks.length > 0 && (
        <ul className={styles.maskList} role="listbox" aria-label="Masks">
          {masks.map((m) => {
            const status = m.shape.type === "segment" ? (pending.includes(m.id) ? "detecting…" : errors[m.id] ? "failed" : "") : "";
            return (
              <li key={m.id} role="option" aria-selected={m.id === selected?.id} className={`${styles.maskRow} ${m.id === selected?.id ? styles.maskSelected : ""}`}>
                <input
                  type="checkbox"
                  checked={m.enabled}
                  aria-label={`Enable ${maskLabel(m)}`}
                  onChange={(e) => void dispatch("develop.mask.update", { maskId: m.id, enabled: e.target.checked })}
                />
                <button type="button" className={styles.maskName} onClick={() => void dispatch("develop.mask.select", { maskId: m.id === selected?.id ? null : m.id })}>
                  <span className={styles.maskType} aria-hidden="true">
                    {SHAPE_ABBR[m.shape.type]}
                  </span>
                  {maskLabel(m)}
                  {m.invert && <span className={styles.maskFlag}> (inverted)</span>}
                  {status && <span className={styles.maskFlag}> {status}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {selected && (
        <MaskEditor
          key={selected.id}
          mask={selected}
          overlay={tool.overlay}
          overlayKeys={overlayShortcut?.strokes}
          error={errors[selected.id]}
          detecting={pending.includes(selected.id)}
        />
      )}
    </Section>
  );
}

function MaskEditor({ mask, overlay, overlayKeys, error, detecting }: { mask: Mask; overlay: boolean; overlayKeys?: string[]; error?: string; detecting: boolean }) {
  const dispatch = useDispatch();
  const [hslChannel, setHslChannel] = useState<"hue" | "saturation" | "luminance">("hue");
  const [name, setName] = useState(mask.name);
  const curve = useMemo(() => monotoneCurve(mask.adjustments.toneCurve), [mask.adjustments.toneCurve]);
  const update = (params: Record<string, unknown>) => void dispatch("develop.mask.update", { maskId: mask.id, ...params });
  const setShape = (shape: MaskShape) => update({ shape });
  const { shape } = mask;

  const slider = (n: MaskSliderName) => {
    const s = SLIDERS[n];
    return (
      <Slider
        key={n}
        id={`mask-${n}`}
        label={s.label}
        value={mask.adjustments[n]}
        min={s.min}
        max={s.max}
        step={s.step}
        track={TRACKS[n]}
        format={n === "exposure" ? (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}` : undefined}
        onChange={(value) => update({ adjustments: { [n]: value } })}
      />
    );
  };

  return (
    <div className={styles.maskEditor} aria-label={`${maskLabel(mask)} mask`} role="group">
      <input
        className={styles.textInput}
        aria-label="Mask name"
        placeholder={maskLabel({ name: "", shape })}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name !== mask.name && update({ name })}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
      <div className={styles.maskOptions}>
        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={overlay} onChange={(e) => void dispatch("develop.maskOverlay.toggle", { on: e.target.checked })} />
          Show overlay {overlayKeys && <Kbd strokes={overlayKeys} />}
        </label>
        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={mask.invert} onChange={(e) => update({ invert: e.target.checked })} />
          Invert
        </label>
      </div>

      {shape.type === "segment" && (
        <>
          <label className={styles.checkboxRow}>
            Detect
            <select className={styles.select} aria-label="What to detect" value={shape.target} onChange={(e) => setShape({ type: "segment", target: e.target.value as SegmentTarget })}>
              {SEGMENT_TARGETS.map((t) => (
                <option key={t} value={t}>
                  {SEGMENT_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          {detecting && (
            <p className={styles.hint} role="status">
              Detecting the {SEGMENT_LABELS[shape.target].toLowerCase()}… The first time, the model (a few MB) is downloaded.
            </p>
          )}
          {error && (
            <p className={`${styles.hint} ${styles.error}`} role="alert">
              {error}
            </p>
          )}
        </>
      )}
      {shape.type === "radial" && (
        <>
          <Slider id="mask-feather" label="Feather" value={shape.feather} min={0} max={100} step={1} resetValue={50} onChange={(feather) => setShape({ ...shape, feather })} />
          <Slider id="mask-angle" label="Angle" value={shape.angle} min={-180} max={180} step={1} format={(v) => `${v > 0 ? "+" : ""}${v}°`} onChange={(angle) => setShape({ ...shape, angle })} />
          <p className={styles.hint}>Drag the centre to move the ellipse and the four handles to resize it.</p>
        </>
      )}
      {shape.type === "linear" && <p className={styles.hint}>Drag the solid line to where the mask is full and the dashed line to where it fades out; the middle handle moves both.</p>}
      {shape.type === "luminance" && (
        <>
          <Slider id="mask-low" label="From" value={shape.low} min={0} max={100} step={1} onChange={(low) => setShape({ ...shape, low: Math.min(low, shape.high) })} />
          <Slider id="mask-high" label="To" value={shape.high} min={0} max={100} step={1} resetValue={100} onChange={(high) => setShape({ ...shape, high: Math.max(high, shape.low) })} />
          <Slider id="mask-feather" label="Feather" value={shape.feather} min={0} max={100} step={1} resetValue={20} onChange={(feather) => setShape({ ...shape, feather })} />
        </>
      )}
      {shape.type === "color" && (
        <>
          <Slider id="mask-hue" label="Hue" value={shape.hue} min={0} max={360} step={1} track={HUE_TRACK} format={(v) => `${v}°`} resetValue={210} onChange={(hue) => setShape({ ...shape, hue })} />
          <Slider id="mask-range" label="Range" value={shape.range} min={5} max={180} step={1} format={(v) => `${v}°`} resetValue={40} onChange={(range) => setShape({ ...shape, range })} />
          <Slider id="mask-feather" label="Feather" value={shape.feather} min={0} max={100} step={1} resetValue={50} onChange={(feather) => setShape({ ...shape, feather })} />
        </>
      )}

      <div className={styles.groupLabel}>White Balance</div>
      {slider("temperature")}
      {slider("tint")}
      <div className={styles.groupLabel}>Tone</div>
      {(["exposure", "contrast", "highlights", "shadows", "whites", "blacks"] as const).map(slider)}
      <div className={styles.groupLabel}>Presence</div>
      {slider("vibrance")}
      {slider("saturation")}
      <div className={styles.groupLabel}>Tone Curve</div>
      <CurveEditor points={mask.adjustments.toneCurve} curve={curve} onChange={(points) => update({ adjustments: { toneCurve: points } })} />
      <div className={styles.groupLabel}>HSL</div>
      <div className={styles.tabs} role="tablist" aria-label="Mask HSL channel">
        {(["hue", "saturation", "luminance"] as const).map((ch) => (
          <button key={ch} type="button" role="tab" aria-selected={hslChannel === ch} className={styles.tab} onClick={() => setHslChannel(ch)}>
            {ch[0]!.toUpperCase() + ch.slice(1)}
          </button>
        ))}
      </div>
      {HSL_BANDS.map((band) => (
        <Slider
          key={band}
          id={`mask-hsl-${band}`}
          label={band[0]!.toUpperCase() + band.slice(1)}
          value={mask.adjustments.hsl[hslChannel][band]}
          min={-100}
          max={100}
          step={1}
          track={`linear-gradient(90deg, #777, ${BAND_COLORS[band]})`}
          onChange={(value) => update({ adjustments: { hsl: { [hslChannel]: { [band]: value } } } })}
        />
      ))}

      <div className={styles.maskButtons}>
        <button type="button" className={styles.reset} disabled={!hasAdjustments(mask)} onClick={() => void dispatch("develop.mask.reset", { maskId: mask.id })}>
          Reset
        </button>
        <button type="button" className={styles.reset} onClick={() => void dispatch("develop.mask.duplicate", { maskId: mask.id })}>
          Duplicate
        </button>
        <button type="button" className={`${styles.reset} ${styles.danger}`} onClick={() => void dispatch("develop.mask.remove", { maskId: mask.id })}>
          Remove
        </button>
      </div>
    </div>
  );
}
