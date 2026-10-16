import type { Page } from "@playwright/test";

export interface FixturePhoto {
  path: string;
  hue: number;
  date: string; // EXIF "YYYY:MM:DD HH:MM:SS"
  model: string;
  iso: number;
  /** EXIF orientation; 6 = stored landscape, displayed portrait (rotate 90° CW). */
  orientation?: number;
}

export const SHOOT: FixturePhoto[] = [
  { path: "IMG_0001.jpg", hue: 20, date: "2026:09:12 07:15:00", model: "TestCam X1", iso: 400 },
  { path: "IMG_0002.jpg", hue: 140, date: "2026:09:12 07:16:30", model: "TestCam X1", iso: 800 },
  { path: "day2/IMG_0003.jpg", hue: 220, date: "2026:09:13 18:02:10", model: "TestCam X1", iso: 3200 },
  { path: "IMG_0004.jpg", hue: 300, date: "2026:09:12 07:20:00", model: "TestCam X1", iso: 100, orientation: 6 },
];

/** Sidecar shipped with IMG_0002 (as if Lightroom wrote it): 4 stars, green. */
const EXISTING_SIDECAR = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="4" xmp:Label="Green"/></rdf:RDF></x:xmpmeta>`;

export const FOLDER = "e2e-shoot";

/**
 * Creates a folder of real JPEGs (with EXIF) in the origin-private file
 * system, and makes the folder picker return it. Runs in the page.
 */
export async function seedShoot(page: Page): Promise<void> {
  const stubPicker = (folder: string) => {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(folder);
  };
  await page.addInitScript(stubPicker, FOLDER); // for later reloads
  await page.evaluate(stubPicker, FOLDER); // and the current page
  await page.evaluate(
    async ({ photos, folder, sidecar }) => {
      function exifSegment(p: { model: string; date: string; iso: number; orientation?: number }): Uint8Array {
        const enc = new TextEncoder();
        const ascii = (s: string) => enc.encode(s + "\0");
        type Entry = [number, number, Uint8Array | number | [number, number] | null];
        const ifd0: Entry[] = [
          [0x010f, 2, ascii("TestCo")],
          [0x0110, 2, ascii(p.model)],
          [0x0112, 3, p.orientation ?? 1],
          [0x8769, 4, null],
        ];
        const exif: Entry[] = [
          [0x829a, 5, [1, 250]],
          [0x829d, 5, [28, 10]],
          [0x8827, 3, p.iso],
          [0x9003, 2, ascii(p.date)],
        ];
        const ifdSize = (n: number) => 2 + n * 12 + 4;
        const exifAt = 8 + ifdSize(ifd0.length);
        let data = exifAt + ifdSize(exif.length);
        const u8 = new Uint8Array(data + 256);
        const dv = new DataView(u8.buffer);
        u8.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
        ifd0[3]![2] = exifAt;
        const writeIfd = (at: number, entries: Entry[]) => {
          dv.setUint16(at, entries.length, true);
          let q = at + 2;
          for (const [tag, type, val] of entries) {
            dv.setUint16(q, tag, true);
            dv.setUint16(q + 2, type, true);
            if (type === 2) {
              const b = val as Uint8Array;
              dv.setUint32(q + 4, b.length, true);
              u8.set(b, data);
              dv.setUint32(q + 8, data, true);
              data += b.length + (b.length % 2);
            } else if (type === 3) {
              dv.setUint32(q + 4, 1, true);
              dv.setUint16(q + 8, val as number, true);
            } else if (type === 4) {
              dv.setUint32(q + 4, 1, true);
              dv.setUint32(q + 8, val as number, true);
            } else {
              const [n, d] = val as [number, number];
              dv.setUint32(q + 4, 1, true);
              dv.setUint32(data, n, true);
              dv.setUint32(data + 4, d, true);
              dv.setUint32(q + 8, data, true);
              data += 8;
            }
            q += 12;
          }
          dv.setUint32(q, 0, true);
        };
        writeIfd(8, ifd0);
        writeIfd(exifAt, exif);
        const tiff = u8.slice(0, data);
        const header = enc.encode("Exif\0\0");
        const len = header.length + tiff.length + 2;
        const seg = new Uint8Array(2 + len);
        seg.set([0xff, 0xe1, len >> 8, len & 255]);
        seg.set(header, 4);
        seg.set(tiff, 4 + header.length);
        return seg;
      }

      async function jpeg(p: (typeof photos)[number]): Promise<Blob> {
        const canvas = new OffscreenCanvas(1200, 800);
        const ctx = canvas.getContext("2d")!;
        const g = ctx.createLinearGradient(0, 0, 1200, 800);
        g.addColorStop(0, `hsl(${p.hue} 60% 60%)`);
        g.addColorStop(1, `hsl(${(p.hue + 60) % 360} 50% 25%)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 1200, 800);
        ctx.fillStyle = "white";
        ctx.font = "bold 120px sans-serif";
        ctx.fillText(p.path.split("/").pop()!, 80, 440);
        const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 })).arrayBuffer());
        const exif = exifSegment(p);
        return new Blob([bytes.slice(0, 2), exif as Uint8Array<ArrayBuffer>, bytes.slice(2)], { type: "image/jpeg" });
      }

      const root = await navigator.storage.getDirectory();
      await root.removeEntry(folder, { recursive: true }).catch(() => undefined);
      const dir = await root.getDirectoryHandle(folder, { create: true });
      const write = async (path: string, data: Blob | string) => {
        const parts = path.split("/");
        let d = dir;
        for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part, { create: true });
        const w = await (await d.getFileHandle(parts.at(-1)!, { create: true })).createWritable();
        await w.write(data);
        await w.close();
      };
      for (const p of photos) await write(p.path, await jpeg(p));
      await write("IMG_0002.xmp", sidecar);
      await write("notes.txt", "not a photo");
    },
    { photos: SHOOT, folder: FOLDER, sidecar: EXISTING_SIDECAR },
  );
}

/** Read a file from the seeded folder (e.g. a sidecar the app wrote). */
export function readShootFile(page: Page, path: string): Promise<string | null> {
  return page.evaluate(
    async ({ folder, path }) => {
      try {
        let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder);
        const parts = path.split("/");
        for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part);
        return await (await (await d.getFileHandle(parts.at(-1)!)).getFile()).text();
      } catch {
        return null;
      }
    },
    { folder: FOLDER, path },
  );
}
