import { recipeSchema, type EditRecipe } from "../develop/recipe";
import type { ColorLabel, Flag } from "../state/types";

/**
 * Read and update culling metadata in XMP sidecars without disturbing
 * anything else in them (develop history from darktable, keywords, …).
 *
 * Interop:
 *  - xmp:Rating 0–5 (Lightroom, Bridge, darktable). Rejected photos are
 *    written as xmp:Rating="-1", the Bridge/darktable convention.
 *  - xmp:Label "Red" | "Yellow" | "Green" | "Blue" | "Purple" (Adobe).
 *  - photo:Rating / photo:Flag keep the exact values (so a rejected photo
 *    keeps its stars, and picks survive), in this app's own namespace.
 *  - photo:Edit holds the develop recipe as JSON, so edits travel with the
 *    folder. (Other apps ignore it; Lightroom's crs: settings aren't mapped.)
 *
 * Uses DOMParser/XMLSerializer, referenced only inside functions so core
 * stays importable in Node.
 */

export const NS = {
  x: "adobe:ns:meta/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  xmp: "http://ns.adobe.com/xap/1.0/",
  photo: "https://github.com/photo-app/ns/1.0/",
  xmlns: "http://www.w3.org/2000/xmlns/",
} as const;

export interface XmpCulling {
  rating: number;
  flag: Flag;
  colorLabel: ColorLabel;
  /** Develop recipe; undefined/null removes it. */
  edit?: EditRecipe | null;
}

export class XmpError extends Error {}

const LABELS: Record<Exclude<ColorLabel, "none">, string> = {
  red: "Red",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
};

const EMPTY_PACKET = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="${NS.x}" x:xmptk="Photo">
 <rdf:RDF xmlns:rdf="${NS.rdf}">
  <rdf:Description rdf:about=""/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
`;

function parse(text: string): Document {
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ""), "application/xml");
  if (doc.getElementsByTagName("parsererror").length || !doc.documentElement) {
    throw new XmpError("Sidecar is not valid XML; leaving it untouched.");
  }
  return doc;
}

function descriptions(doc: Document): Element[] {
  return [...doc.getElementsByTagNameNS(NS.rdf, "Description")];
}

/** A property may be an attribute on any rdf:Description or a child element. */
function readProp(doc: Document, ns: string, local: string): string | null {
  for (const d of descriptions(doc)) {
    const attr = d.getAttributeNS(ns, local);
    if (attr !== null && attr !== "") return attr;
    const el = [...d.children].find((c) => c.namespaceURI === ns && c.localName === local);
    if (el?.textContent) return el.textContent.trim();
  }
  return null;
}

function ensurePrefix(el: Element, prefix: string, ns: string): void {
  if (el.lookupNamespaceURI(prefix) !== ns) el.setAttributeNS(NS.xmlns, `xmlns:${prefix}`, ns);
}

/** Set (or with value null, remove) a property, keeping it in one place. */
function writeProp(doc: Document, prefix: "xmp" | "photo", local: string, value: string | null): void {
  const ns = NS[prefix];
  const descs = descriptions(doc);
  for (const d of descs) {
    for (const c of [...d.children]) if (c.namespaceURI === ns && c.localName === local) c.remove();
    if (d.hasAttributeNS(ns, local)) d.removeAttributeNS(ns, local);
  }
  if (value === null) return;
  const target = descs[0];
  if (!target) throw new XmpError("Sidecar has no rdf:Description.");
  ensurePrefix(target, prefix, ns);
  target.setAttributeNS(ns, `${prefix}:${local}`, value);
}

export function parseXmp(text: string): Partial<XmpCulling> {
  const doc = parse(text);
  const out: Partial<XmpCulling> = {};

  const xmpRating = readProp(doc, NS.xmp, "Rating");
  const ownRating = readProp(doc, NS.photo, "Rating");
  const ownFlag = readProp(doc, NS.photo, "Flag");
  const label = readProp(doc, NS.xmp, "Label");

  const n = xmpRating === null ? null : Number.parseInt(xmpRating, 10);
  if (ownRating !== null && /^[0-5]$/.test(ownRating)) out.rating = Number(ownRating);
  else if (n !== null && n >= 0 && n <= 5) out.rating = n;
  else if (n === -1) out.rating = 0;

  if (ownFlag === "pick" || ownFlag === "reject" || ownFlag === "none") out.flag = ownFlag;
  else if (n === -1) out.flag = "reject";

  if (label !== null) {
    const found = (Object.keys(LABELS) as Array<keyof typeof LABELS>).find((k) => k === label.trim().toLowerCase());
    out.colorLabel = found ?? "none";
  }

  const edit = readProp(doc, NS.photo, "Edit");
  if (edit !== null) {
    try {
      const parsed = recipeSchema.safeParse(JSON.parse(edit));
      if (parsed.success) out.edit = parsed.data;
    } catch {
      // Malformed recipe: ignore it rather than lose the photo's other metadata.
    }
  }
  return out;
}

/** Return `existing` (or a new packet) with culling fields updated. Throws XmpError on unparseable input. */
export function writeXmp(existing: string | null, fields: XmpCulling): string {
  const doc = parse(existing ?? EMPTY_PACKET);
  writeProp(doc, "xmp", "Rating", String(fields.flag === "reject" ? -1 : fields.rating));
  writeProp(doc, "xmp", "Label", fields.colorLabel === "none" ? null : LABELS[fields.colorLabel]);
  writeProp(doc, "photo", "Rating", String(fields.rating));
  writeProp(doc, "photo", "Flag", fields.flag);
  writeProp(doc, "photo", "Edit", fields.edit ? JSON.stringify(fields.edit) : null);
  const xml = new XMLSerializer().serializeToString(doc);
  return xml.endsWith("\n") ? xml : xml + "\n";
}
