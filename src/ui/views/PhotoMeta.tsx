import type { ColorLabel, ExifSummary, Flag, PhotoRecord } from "../../core/state/types";
import styles from "./PhotoMeta.module.css";

export function Stars({ rating }: { rating: number }) {
  return (
    <span className={styles.stars} aria-label={rating ? `${rating} stars` : "Unrated"}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} aria-hidden="true" className={n <= rating ? styles.on : styles.off}>
          ★
        </span>
      ))}
    </span>
  );
}

export function FlagMark({ flag }: { flag: Flag }) {
  if (flag === "none") return null;
  return (
    <span className={flag === "pick" ? styles.pick : styles.reject} aria-label={flag === "pick" ? "Picked" : "Rejected"}>
      {flag === "pick" ? "⚑" : "✕"}
    </span>
  );
}

export function LabelDot({ label }: { label: ColorLabel }) {
  if (label === "none") return null;
  return <span className={styles.label} style={{ background: `var(--label-${label})` }} aria-label={`${label} label`} />;
}

/** Stand-in preview for the sample library, which has no real files. */
export function Placeholder({ photo, className, decorative = false }: { photo: PhotoRecord; className?: string; decorative?: boolean }) {
  const h = photo.placeholderHue ?? 0;
  return (
    <div
      className={`${styles.placeholder} ${className ?? ""}`}
      style={{
        background: `radial-gradient(circle at 70% 30%, hsl(${(h + 40) % 360} 70% 70% / 0.9) 0 8%, transparent 9%),
          linear-gradient(170deg, hsl(${h} 45% 55%) 0%, hsl(${(h + 30) % 360} 40% 30%) 60%, hsl(${(h + 60) % 360} 35% 16%) 100%)`,
      }}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": photo.fileName })}
    />
  );
}

export function formatCaptured(capturedAt: string): string {
  const d = new Date(capturedAt); // zone-less ISO parses as local time
  return Number.isNaN(d.getTime()) ? capturedAt : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatExposure(exif: ExifSummary | undefined): string[] {
  if (!exif) return [];
  const parts: string[] = [];
  if (exif.focalLength) parts.push(`${Math.round(exif.focalLength)} mm`);
  if (exif.aperture) parts.push(`ƒ/${exif.aperture}`);
  if (exif.exposureTime) {
    parts.push(exif.exposureTime >= 1 ? `${exif.exposureTime}s` : `1/${Math.round(1 / exif.exposureTime)}s`);
  }
  if (exif.iso) parts.push(`ISO ${exif.iso}`);
  return parts;
}
