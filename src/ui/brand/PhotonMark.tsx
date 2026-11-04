import styles from "./PhotonMark.module.css";

/**
 * The Photon mark: a lens ring with a particle of light breaking out of it.
 * public/icon.svg draws the same paths on the app-icon tile.
 */
export function PhotonMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={[styles.mark, className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path className={styles.ring} d="M19.52 9.26A8 8 0 1 1 14.74 4.48" />
      <circle className={styles.core} cx="12" cy="12" r="3" />
      <circle className={styles.photon} cx="17.66" cy="6.34" r="2.2" />
    </svg>
  );
}

/** Mark plus the "Photon" name. */
export function PhotonWordmark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span className={[styles.wordmark, className].filter(Boolean).join(" ")} style={{ fontSize: size * 0.8 }}>
      <PhotonMark size={size} />
      <span>Photon</span>
    </span>
  );
}
