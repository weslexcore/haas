/** Identifies a file version: index data cached for one key is stale for another. */
export const fileKey = (f: { size?: number; lastModified?: number }) => `${f.size ?? 0}-${f.lastModified ?? 0}`;

/** Camera-style local time: "YYYY-MM-DDTHH:mm:ss" with no zone. */
export function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
