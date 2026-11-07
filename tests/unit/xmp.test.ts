// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { maskSchema } from "../../src/core/develop/recipe";
import { parseXmp, writeXmp, XmpError } from "../../src/core/xmp/xmp";

const darktable = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 4.4.0-Exiv2">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:darktable="http://darktable.sf.net/"
    xmp:Rating="3"
    darktable:history_end="4">
   <darktable:history>
    <rdf:Seq><rdf:li darktable:operation="exposure"/></rdf:Seq>
   </darktable:history>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

const lightroomElements = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:Rating>4</xmp:Rating>
   <xmp:Label>Green</xmp:Label>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

describe("XMP sidecars", () => {
  it("reads attribute-style ratings (darktable)", () => {
    expect(parseXmp(darktable)).toEqual({ rating: 3 });
  });

  it("reads element-style rating and label (Lightroom/Bridge)", () => {
    expect(parseXmp(lightroomElements)).toEqual({ rating: 4, colorLabel: "green" });
  });

  it("treats xmp:Rating -1 as rejected", () => {
    expect(parseXmp(darktable.replace('xmp:Rating="3"', 'xmp:Rating="-1"'))).toEqual({ rating: 0, flag: "reject" });
  });

  it("creates a new packet that round-trips", () => {
    const xml = writeXmp(null, { rating: 5, flag: "pick", colorLabel: "red" });
    expect(xml).toContain("<?xpacket");
    expect(xml).toContain('xmp:Rating="5"');
    expect(xml).toContain('xmp:Label="Red"');
    expect(parseXmp(xml)).toEqual({ rating: 5, flag: "pick", colorLabel: "red" });
  });

  it("writes reject as -1 but keeps the real rating in its own namespace", () => {
    const xml = writeXmp(null, { rating: 4, flag: "reject", colorLabel: "none" });
    expect(xml).toContain('xmp:Rating="-1"');
    expect(parseXmp(xml)).toEqual({ rating: 4, flag: "reject" });
  });

  it("preserves everything else when updating an existing sidecar", () => {
    const xml = writeXmp(darktable, { rating: 1, flag: "none", colorLabel: "blue" });
    expect(xml).toContain("darktable:history_end=\"4\"");
    expect(xml).toContain('darktable:operation="exposure"');
    expect(parseXmp(xml)).toEqual({ rating: 1, flag: "none", colorLabel: "blue" });
  });

  it("replaces element-style values instead of duplicating them", () => {
    const xml = writeXmp(lightroomElements, { rating: 2, flag: "none", colorLabel: "none" });
    expect(xml).not.toContain("<xmp:Rating>");
    expect(xml).not.toContain("Green");
    expect(parseXmp(xml)).toEqual({ rating: 2, flag: "none" });
  });

  it("refuses to overwrite a corrupt sidecar", () => {
    expect(() => writeXmp("<x:xmpmeta><broken", { rating: 1, flag: "none", colorLabel: "none" })).toThrow(XmpError);
  });
});

describe("develop recipe in XMP", () => {
  it("round-trips the recipe and removes it when reset", async () => {
    const { defaultRecipe } = await import("../../src/core/develop/recipe");
    const edit = { ...defaultRecipe(), exposure: 0.7, toneCurve: [[0, 0.1], [1, 1]] as Array<[number, number]> };
    // Masks travel in the sidecar too, in Photon's own namespace.
    edit.masks = [maskSchema.parse({ id: "m1", name: "Sky", shape: { type: "segment", target: "sky" }, adjustments: { exposure: -0.8 } })];
    const xml = writeXmp(null, { rating: 3, flag: "none", colorLabel: "none", edit });
    expect(parseXmp(xml).edit).toEqual(edit);
    expect(parseXmp(xml).edit?.masks[0]).toMatchObject({ id: "m1", shape: { target: "sky" }, adjustments: { exposure: -0.8, contrast: 0 } });
    const cleared = writeXmp(xml, { rating: 3, flag: "none", colorLabel: "none", edit: null });
    expect(parseXmp(cleared).edit).toBeUndefined();
  });

  it("ignores a malformed recipe", () => {
    const xml = writeXmp(null, { rating: 1, flag: "none", colorLabel: "none" }).replace('photo:Rating="1"', 'photo:Rating="1" photo:Edit="{oops"');
    expect(parseXmp(xml)).toEqual({ rating: 1, flag: "none" });
  });
});
