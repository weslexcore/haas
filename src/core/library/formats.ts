/** Image types the browser decodes itself. */
export const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
};

/** Camera RAW types, decoded with LibRaw (WebAssembly). */
export const RAW_TYPES: Record<string, string> = {
  "3fr": "image/x-hasselblad-3fr",
  arw: "image/x-sony-arw",
  cr2: "image/x-canon-cr2",
  cr3: "image/x-canon-cr3",
  crw: "image/x-canon-crw",
  dng: "image/x-adobe-dng",
  erf: "image/x-epson-erf",
  iiq: "image/x-phaseone-iiq",
  kdc: "image/x-kodak-kdc",
  mos: "image/x-leaf-mos",
  mrw: "image/x-minolta-mrw",
  nef: "image/x-nikon-nef",
  nrw: "image/x-nikon-nrw",
  orf: "image/x-olympus-orf",
  pef: "image/x-pentax-pef",
  raf: "image/x-fuji-raf",
  rw2: "image/x-panasonic-rw2",
  rwl: "image/x-leica-rwl",
  sr2: "image/x-sony-sr2",
  srf: "image/x-sony-srf",
  srw: "image/x-samsung-srw",
  x3f: "image/x-sigma-x3f",
};

const RAW_MIME_TYPES = new Set(Object.values(RAW_TYPES));

export function extension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** MIME type of a photo file the app lists (browser image or RAW), else null. */
export const imageMimeType = (path: string): string | null => IMAGE_TYPES[extension(path)] ?? RAW_TYPES[extension(path)] ?? null;

export const isRawPath = (path: string) => extension(path) in RAW_TYPES;
export const isRawMimeType = (mimeType: string | undefined) => !!mimeType && RAW_MIME_TYPES.has(mimeType);

/** "a/DSC_1.ARW" → "a/dsc_1": photos with the same key are one shot in two formats. */
const shotKey = (path: string) => {
  const dot = path.lastIndexOf(".");
  return (dot > path.lastIndexOf("/") ? path.slice(0, dot) : path).toLowerCase();
};

/**
 * RAW+JPEG pairs (as cameras write them) are one photo, as in Lightroom: the
 * RAW is listed and the JPEG travels with it like a sidecar (moved to and
 * from _Rejected together). Returns the paths to list, and each listed RAW's
 * companion.
 */
export function pairRawWithJpeg(paths: string[]): { photos: string[]; companions: Map<string, string> } {
  const raws = new Map<string, string>();
  for (const p of paths) if (isRawPath(p)) raws.set(shotKey(p), p);
  const companions = new Map<string, string>();
  const photos: string[] = [];
  for (const p of paths) {
    const raw = !isRawPath(p) && IMAGE_TYPES[extension(p)] ? raws.get(shotKey(p)) : undefined;
    if (raw && !companions.has(raw)) companions.set(raw, p);
    else photos.push(p);
  }
  return { photos, companions };
}

export const isSidecarPath = (path: string) => extension(path) === "xmp";

/**
 * Subfolder that "Remove Rejected Photos" moves photos into, mirroring their
 * original paths. Never listed in the library; emptied only on request.
 */
export const TRASH_DIR = "_Rejected";

/** Subfolder that exported JPEGs are written to (when the folder is writable). */
export const EXPORTS_DIR = "_Exports";

/** Folder names never scanned: hidden folders, NAS/OS metadata, and the app's own folders at the root. */
export const isIgnoredDir = (name: string, atRoot: boolean) =>
  name.startsWith(".") || name === "@eaDir" || name === "__MACOSX" || (atRoot && (name === TRASH_DIR || name === EXPORTS_DIR));

/** "a/IMG_1.jpg" → "IMG_1" */
export function baseName(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

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

/** "IMG_1.jpg", then "IMG_1-2.jpg", "IMG_1-3.jpg"… — the first name `taken` says is free. */
export function uniqueName(fileName: string, taken: (name: string) => boolean): string {
  if (!taken(fileName)) return fileName;
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  for (let i = 2; ; i++) if (!taken(`${stem}-${i}${ext}`)) return `${stem}-${i}${ext}`;
}

/** Async variant for file systems. */
export async function uniqueNameAsync(fileName: string, taken: (name: string) => Promise<boolean>): Promise<string> {
  if (!(await taken(fileName))) return fileName;
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  for (let i = 2; ; i++) if (!(await taken(`${stem}-${i}${ext}`))) return `${stem}-${i}${ext}`;
}
