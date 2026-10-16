import { useMemo, useState, type ReactNode } from "react";
import type { Histogram } from "../../core/develop/pipeline";
import { HSL_BANDS, SLIDERS, defaultRecipe, type HslBand, type SliderName } from "../../core/develop/recipe";
import { monotoneCurve } from "../../core/develop/tone-curve";
import type { PhotoRecord } from "../../core/state/types";
import { useAppState, useDispatch, useShortcut } from "../hooks";
import { ActionButton } from "../shell/ActionButton";
import { Kbd } from "../shell/Kbd";
import { CurveEditor, HistogramView, Slider } from "./controls";
import styles from "./DevelopPanel.module.css";

const TRACKS: Partial<Record<SliderName, string>> = {
  temperature: "linear-gradient(90deg, #3b6fd8, #d8d8d8, #e3b23c)",
  tint: "linear-gradient(90deg, #3fae4a, #d8d8d8, #c447c4)",
  saturation: "linear-gradient(90deg, #888, #e0412f)",
  vibrance: "linear-gradient(90deg, #888, #e07b2f)",
};

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

const ASPECTS = ["original", "1:1", "4:5", "5:4", "2:3", "3:2", "16:9", "9:16"] as const;

function Section({ title, children, defaultOpen = true, action }: { title: string; children: ReactNode; defaultOpen?: boolean; action?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
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

/** Every control dispatches a develop action; continuous drags coalesce into one undo step. */
export function DevelopPanel({ photo, histogram }: { photo: PhotoRecord; histogram: Histogram | null }) {
  const dispatch = useDispatch();
  const recipe = photo.edit ?? DEFAULT;
  const cropTool = useAppState((s) => s.develop.cropTool);
  const [hslChannel, setHslChannel] = useState<"hue" | "saturation" | "luminance">("hue");
  const cropShortcut = useShortcut("develop.cropTool.toggle");
  const curve = useMemo(() => monotoneCurve(recipe.toneCurve), [recipe.toneCurve]);

  const slider = (name: SliderName) => {
    const s = SLIDERS[name];
    return (
      <Slider
        key={name}
        label={s.label}
        value={recipe[name]}
        min={s.min}
        max={s.max}
        step={s.step}
        track={TRACKS[name]}
        format={name === "exposure" ? (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}` : undefined}
        onChange={(value) => void dispatch("develop.adjust", { setting: name, value })}
      />
    );
  };

  return (
    <aside className={styles.panel} aria-label="Develop controls">
      <HistogramView histogram={histogram} />

      <div className={styles.toolbar}>
        <ActionButton actionId="develop.cropTool.toggle" className={styles.tool} aria-pressed={cropTool}>
          Crop {cropShortcut && <Kbd strokes={cropShortcut.strokes} />}
        </ActionButton>
        <ActionButton actionId="view.beforeAfter.toggle" className={styles.tool}>
          Before/After
        </ActionButton>
      </div>

      <Section title="Basic">
        <div className={styles.groupLabel}>White Balance</div>
        {slider("temperature")}
        {slider("tint")}
        <div className={styles.groupLabel}>Tone</div>
        {(["exposure", "contrast", "highlights", "shadows", "whites", "blacks"] as const).map(slider)}
        <div className={styles.groupLabel}>Presence</div>
        {slider("vibrance")}
        {slider("saturation")}
      </Section>

      <Section
        title="Tone Curve"
        action={
          <button type="button" className={styles.reset} onClick={() => void dispatch("develop.reset", { groups: ["toneCurve"] })}>
            Reset
          </button>
        }
      >
        <CurveEditor
          points={recipe.toneCurve}
          curve={curve}
          onChange={(points) => void dispatch("develop.toneCurve.set", { points })}
        />
      </Section>

      <Section
        title="HSL"
        defaultOpen={false}
        action={
          <button type="button" className={styles.reset} onClick={() => void dispatch("develop.reset", { groups: ["hsl"] })}>
            Reset
          </button>
        }
      >
        <div className={styles.tabs} role="tablist" aria-label="HSL channel">
          {(["hue", "saturation", "luminance"] as const).map((ch) => (
            <button key={ch} type="button" role="tab" aria-selected={hslChannel === ch} className={styles.tab} onClick={() => setHslChannel(ch)}>
              {ch[0]!.toUpperCase() + ch.slice(1)}
            </button>
          ))}
        </div>
        {HSL_BANDS.map((band) => (
          <Slider
            key={band}
            label={band[0]!.toUpperCase() + band.slice(1)}
            value={recipe.hsl[hslChannel][band]}
            min={-100}
            max={100}
            step={1}
            track={`linear-gradient(90deg, #777, ${BAND_COLORS[band]})`}
            onChange={(value) => void dispatch("develop.hsl.set", { channel: hslChannel, band, value })}
          />
        ))}
      </Section>

      <Section title="Crop & Straighten" defaultOpen={cropTool}>
        <Slider
          label="Angle"
          value={recipe.crop.angle}
          min={-45}
          max={45}
          step={0.1}
          format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}°`}
          onChange={(angle) => void dispatch("develop.crop.set", { angle })}
        />
        <div className={styles.aspects} role="group" aria-label="Aspect ratio">
          {ASPECTS.map((a) => (
            <button key={a} type="button" className={styles.aspect} onClick={() => void dispatch("develop.crop.set", { aspect: a })}>
              {a === "original" ? "Original" : a}
            </button>
          ))}
        </div>
        <button type="button" className={styles.reset} onClick={() => void dispatch("develop.reset", { groups: ["crop"] })}>
          Reset crop
        </button>
      </Section>

      <div className={styles.footer}>
        <ActionButton actionId="develop.settings.copy" className={styles.footerButton}>Copy</ActionButton>
        <ActionButton actionId="develop.settings.paste" className={styles.footerButton}>Paste</ActionButton>
        <ActionButton actionId="develop.settings.sync" className={styles.footerButton}>Sync</ActionButton>
        <ActionButton actionId="develop.reset" className={styles.footerButton}>Reset</ActionButton>
        <ActionButton actionId="develop.export" className={`${styles.footerButton} ${styles.primary}`}>Export…</ActionButton>
      </div>
    </aside>
  );
}

const DEFAULT = defaultRecipe();
