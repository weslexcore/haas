/** Image types the app lists. RAW arrives later (LibRaw/WASM). */
export const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
};

export function extension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export const imageMimeType = (path: string): string | null => IMAGE_TYPES[extension(path)] ?? null;

export const isSidecarPath = (path: string) => extension(path) === "xmp";

/**
 * Subfolder that "Remove Rejected Photos" moves photos into, mirroring their
 * original paths. Never listed in the library; emptied only on request.
 */
export const TRASH_DIR = "_Rejected";

/** Folder names never scanned: hidden folders, NAS/OS metadata, and the app's trash at the root. */
export const isIgnoredDir = (name: string, atRoot: boolean) =>
  name.startsWith(".") || name === "@eaDir" || name === "__MACOSX" || (atRoot && name === TRASH_DIR);

export const trashPath = (path: string) => `${TRASH_DIR}/${path}`;

/**
 * Possible sidecar paths for a photo, in preference order for new files:
 * "DSC_0001.xmp" (Adobe), then "DSC_0001.jpg.xmp" (darktable).
 * An existing sidecar of either form is used.
 */
export function sidecarCandidates(photoPath: string): string[] {
  const dot = photoPath.lastIndexOf(".");
  const base = dot > photoPath.lastIndexOf("/") ? photoPath.slice(0, dot) : photoPath;
  return [`${base}.xmp`, `${photoPath}.xmp`];
}

export function splitPath(path: string): { dir: string[]; name: string } {
  const parts = path.split("/");
  return { dir: parts.slice(0, -1), name: parts.at(-1)! };
}
