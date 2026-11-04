// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { MemorySource } from "../../src/adapters/memory-source";
import { PAIRS_SETTINGS_KEY } from "../../src/actions/library";
import { pairRawWithJpeg } from "../../src/core/library/formats";
import { MetadataSync } from "../../src/core/library/metadata-sync";
import { companionOf, selectLibraryIds } from "../../src/core/state/selectors";
import { paramsJsonSchema } from "../../src/core/manifest/build-manifest";
import { parseXmp, writeXmp } from "../../src/core/xmp/xmp";
import { requiresParams } from "../../src/core/actions/dispatcher";
import { shouldAskForParams } from "../../src/ui/palette/schema-form";
import { createTestRuntime } from "./helpers";

async function openShoot(writable = true) {
  const rt = await createTestRuntime({ loadSample: false });
  const source = new MemorySource({ id: "f1", name: "Shoot", kind: "memory", writable }, {
    "IMG_1.jpg": "1",
    "IMG_2.jpg": "22",
    "sub/IMG_3.jpg": "333",
    "IMG_4.jpg": "4444",
    "IMG_2.xmp": writeXmp(null, { rating: 2, flag: "reject", colorLabel: "none" }),
  });
  rt.library.nextPick = source;
  await rt.dispatch("library.folder.open");
  return { rt, source };
}

const ids = (rt: Awaited<ReturnType<typeof createTestRuntime>>) => rt.store.getState().photos.order;

describe("removing rejected photos", () => {
  it("moves rejected photos and their sidecars into _Rejected, and drops them from the library", async () => {
    const { rt, source } = await openShoot();
    await rt.dispatch("library.flag.set", { flag: "reject", photoIds: ["sub/IMG_3.jpg"] });
    await rt.dispatch("library.selection.set", { ids: ["IMG_2.jpg"] });

    const r = await rt.dispatch("library.rejected.remove");
    expect(r).toMatchObject({ ok: true, value: { removed: 2, failed: [] } });
    expect(ids(rt)).toEqual(["IMG_1.jpg", "IMG_4.jpg"]);
    expect(source.files.has("_Rejected/IMG_2.jpg")).toBe(true);
    expect(source.files.has("_Rejected/IMG_2.xmp")).toBe(true);
    expect(source.files.has("_Rejected/sub/IMG_3.jpg")).toBe(true);
    expect(source.files.has("IMG_2.jpg")).toBe(false);
    expect(rt.store.getState().library.removedCount).toBe(2);
    // Lands on the next remaining photo.
    expect(rt.store.getState().selection.activeId).toBe("IMG_4.jpg");
  });

  it("is only available with write access and when something is rejected", async () => {
    const { rt } = await openShoot();
    await rt.dispatch("library.flag.set", { flag: "none", photoIds: ["IMG_2.jpg"] });
    expect(rt.dispatcher.isAvailable("library.rejected.remove")).toBe(false);

    const ro = await openShoot(false);
    expect(ro.rt.dispatcher.isAvailable("library.rejected.remove")).toBe(false);
    expect(await ro.rt.dispatch("library.rejected.remove")).toMatchObject({ ok: false, error: "unavailable" });
  });

  it("refuses photos that aren't rejected", async () => {
    const { rt, source } = await openShoot();
    const r = await rt.dispatch("library.rejected.remove", { photoIds: ["IMG_1.jpg"] });
    expect(r).toMatchObject({ ok: false, error: "failed" });
    expect(source.files.has("IMG_1.jpg")).toBe(true);
  });

  it("counts existing _Rejected contents on load, and never lists them as photos", async () => {
    const { rt, source } = await openShoot();
    await rt.dispatch("library.rejected.remove");
    rt.library.nextPick = source;
    await rt.dispatch("library.folder.open");
    expect(ids(rt)).not.toContain("IMG_2.jpg");
    expect(rt.store.getState().library.removedCount).toBe(1);
    expect(await rt.dispatch("library.removed.list")).toMatchObject({ ok: true, value: [{ path: "IMG_2.jpg" }] });
  });
});

describe("restoring and emptying", () => {
  it("restores photos with their sidecars and ratings", async () => {
    const { rt, source } = await openShoot();
    await rt.dispatch("library.rejected.remove");
    const r = await rt.dispatch("library.removed.restore");
    expect(r).toMatchObject({ ok: true, value: { restored: 1 } });
    expect(ids(rt)).toEqual(["IMG_1.jpg", "IMG_2.jpg", "IMG_4.jpg", "sub/IMG_3.jpg"]);
    expect(rt.store.getState().photos.byId["IMG_2.jpg"]).toMatchObject({ rating: 2, flag: "reject" });
    expect(source.files.has("IMG_2.xmp")).toBe(true);
    expect(rt.store.getState().library.removedCount).toBe(0);
  });

  it("won't overwrite a file that reappeared at the original path", async () => {
    const { rt, source } = await openShoot();
    await rt.dispatch("library.rejected.remove");
    source.files.set("IMG_2.jpg", { data: new Blob(["new"]), lastModified: 1 });
    const r = await rt.dispatch<{ restored: number; failed: unknown[] }>("library.removed.restore");
    expect(r).toMatchObject({ ok: true, value: { restored: 0 } });
    if (r.ok) expect(r.value.failed).toHaveLength(1);
    expect(await source.files.get("IMG_2.jpg")!.data.text()).toBe("new");
  });

  it("permanently deletes only with confirm: true", async () => {
    const { rt, source } = await openShoot();
    await rt.dispatch("library.rejected.remove");
    expect(await rt.dispatch("library.removed.empty", {})).toMatchObject({ ok: false, error: "invalid_params" });
    expect(await rt.dispatch("library.removed.empty", { confirm: false })).toMatchObject({ ok: false, error: "invalid_params" });
    expect(source.files.has("_Rejected/IMG_2.jpg")).toBe(true);

    expect(await rt.dispatch("library.removed.empty", { confirm: true })).toMatchObject({ ok: true, value: { deleted: 1 } });
    expect([...source.files.keys()].some((k) => k.startsWith("_Rejected/"))).toBe(false);
    expect(rt.store.getState().library.removedCount).toBe(0);
    expect((await rt.services.metadata.load("f1")).has("IMG_2.jpg")).toBe(false);
  });
});

describe("palette parameter step", () => {
  it("runs id-list-only actions directly, but asks for real choices and confirmations", async () => {
    const rt = await createTestRuntime();
    const ask = (id: string) => {
      const a = rt.registry.get(id)!;
      return shouldAskForParams(paramsJsonSchema(a), !requiresParams(a));
    };
    expect(ask("library.rejected.remove")).toBe(false);
    expect(ask("library.removed.restore")).toBe(false);
    expect(ask("library.removed.empty")).toBe(true);
    expect(ask("library.rating.set")).toBe(true);
    expect(ask("app.shortcuts.reset")).toBe(true);
    expect(ask("navigation.next")).toBe(false);
  });
});

describe("undo and redo of removal", () => {
  it("undo moves the files back and restores the exact previous state; redo removes again", async () => {
    const { rt, source } = await openShoot();
    await rt.dispatch("library.selection.set", { ids: ["IMG_2.jpg"] });
    const before = rt.store.getState().photos;
    await rt.dispatch("library.rejected.remove");
    expect(rt.history.getSnapshot().undoLabel).toBe("Remove Rejected Photos");

    expect(await rt.dispatch("history.undo")).toMatchObject({ ok: true, value: true });
    expect(rt.store.getState().photos).toEqual(before);
    expect(rt.store.getState().selection.activeId).toBe("IMG_2.jpg");
    expect(rt.store.getState().library.removedCount).toBe(0);
    expect(source.files.has("IMG_2.jpg")).toBe(true);
    expect(source.files.has("IMG_2.xmp")).toBe(true);

    await rt.dispatch("history.redo");
    expect(source.files.has("_Rejected/IMG_2.jpg")).toBe(true);
    expect(ids(rt)).not.toContain("IMG_2.jpg");
  });

  it("earlier edits stay undoable after a removal (undo the removal first)", async () => {
    const { rt } = await openShoot();
    await rt.dispatch("library.rating.set", { rating: 5, photoIds: ["IMG_2.jpg"] });
    await rt.dispatch("library.rejected.remove");
    await rt.dispatch("history.undo"); // brings IMG_2 back
    await rt.dispatch("history.undo"); // its rating change
    expect(rt.store.getState().photos.byId["IMG_2.jpg"]!.rating).toBe(2);
  });

  it("a failed undo changes nothing and keeps the step undoable", async () => {
    const { rt, source } = await openShoot();
    await rt.dispatch("library.flag.set", { flag: "reject", photoIds: ["IMG_4.jpg"] });
    await rt.dispatch("library.rejected.remove"); // IMG_2 and IMG_4
    source.files.set("IMG_4.jpg", { data: new Blob(["someone else's file"]), lastModified: 1 });

    const r = await rt.dispatch("history.undo");
    expect(r).toMatchObject({ ok: false, error: "failed" });
    expect(source.files.has("_Rejected/IMG_2.jpg")).toBe(true); // put back after the partial move
    expect(ids(rt)).not.toContain("IMG_2.jpg");
    expect(rt.history.canUndo).toBe(true);
    expect(await source.files.get("IMG_4.jpg")!.data.text()).toBe("someone else's file");
  });

  it("restore is undoable too", async () => {
    const { rt, source } = await openShoot();
    await rt.dispatch("library.rejected.remove");
    await rt.dispatch("library.removed.restore");
    await rt.dispatch("history.undo");
    expect(source.files.has("_Rejected/IMG_2.jpg")).toBe(true);
    expect(rt.store.getState().library.removedCount).toBe(1);
  });

  it("permanent delete clears history", async () => {
    const { rt } = await openShoot();
    await rt.dispatch("library.rejected.remove");
    await rt.dispatch("library.removed.empty", { confirm: true });
    expect(rt.history.canUndo).toBe(false);
  });
});

describe("RAW+JPEG pairs", () => {
  it("pairs a RAW with a JPEG of the same name (any case), and only then", () => {
    const { photos, companions } = pairRawWithJpeg(["a/DSC_1.ARW", "a/dsc_1.jpg", "DSC_1.jpg", "IMG_2.jpg", "IMG_3.CR3", "IMG_3.xmp"]);
    expect(photos).toEqual(["a/DSC_1.ARW", "DSC_1.jpg", "IMG_2.jpg", "IMG_3.CR3", "IMG_3.xmp"]);
    expect([...companions]).toEqual([["a/DSC_1.ARW", "a/dsc_1.jpg"]]);
  });

  async function openRawShoot() {
    const rt = await createTestRuntime({ loadSample: false });
    const source = new MemorySource({ id: "f2", name: "Raw", kind: "memory", writable: true }, {
      "DSC_1.NEF": "raw",
      "DSC_1.JPG": "jpeg",
      "DSC_2.NEF": "raw2",
    });
    rt.library.nextPick = source;
    await rt.dispatch("library.folder.open");
    return { rt, source };
  }
  const listed = (rt: Awaited<ReturnType<typeof createTestRuntime>>) => selectLibraryIds(rt.store.getState());
  const files = (source: MemorySource) => [...source.files.keys()].filter((p) => !p.endsWith(".xmp")).sort();

  it("lists the pair once, and moves and restores the JPEG with the RAW", async () => {
    const { rt, source } = await openRawShoot();
    expect(ids(rt)).toEqual(["DSC_1.JPG", "DSC_1.NEF", "DSC_2.NEF"]); // every file is loaded…
    expect(listed(rt)).toEqual(["DSC_1.NEF", "DSC_2.NEF"]); // …but the pair is one photo
    expect(companionOf(rt.store.getState(), "DSC_1.NEF")).toBe("DSC_1.JPG");
    expect(rt.store.getState().photos.byId["DSC_1.NEF"]).toMatchObject({ mimeType: "image/x-nikon-nef" });

    await rt.dispatch("library.flag.set", { flag: "reject", photoIds: ["DSC_1.NEF"] });
    const r = await rt.dispatch("library.rejected.remove");
    expect(r).toMatchObject({ ok: true, value: { removed: 1 } });
    expect(files(source)).toEqual(["DSC_2.NEF", "_Rejected/DSC_1.JPG", "_Rejected/DSC_1.NEF"]);
    expect(listed(rt)).toEqual(["DSC_2.NEF"]);

    await rt.dispatch("history.undo");
    expect(files(source)).toEqual(["DSC_1.JPG", "DSC_1.NEF", "DSC_2.NEF"]);
    expect(listed(rt)).toEqual(["DSC_1.NEF", "DSC_2.NEF"]);
    expect(rt.store.getState().selection.ids).toEqual(["DSC_1.NEF"]); // the hidden JPEG isn't selected
  });

  it("ungrouped, the RAW and the JPEG are separate photos; the setting is remembered and the shortcut toggles it", async () => {
    const { rt, source } = await openRawShoot();
    await rt.dispatch("library.selection.set", { ids: ["DSC_1.NEF"] });

    // Shift+J toggles it.
    expect(rt.keybindings.handleKeyDown({ key: "J", shiftKey: true, metaKey: false, ctrlKey: false, altKey: false, preventDefault() {} })).toBe(true);
    await vi.waitFor(() => expect(rt.store.getState().library.groupRawJpeg).toBe(false));
    expect(await rt.services.settings.get(PAIRS_SETTINGS_KEY)).toBe(false);
    expect(listed(rt)).toEqual(["DSC_1.JPG", "DSC_1.NEF", "DSC_2.NEF"]);
    expect(companionOf(rt.store.getState(), "DSC_1.NEF")).toBeUndefined();

    // Removing the RAW leaves the JPEG in the library.
    await rt.dispatch("library.flag.set", { flag: "reject", photoIds: ["DSC_1.NEF"] });
    await rt.dispatch("library.rejected.remove");
    expect(files(source)).toEqual(["DSC_1.JPG", "DSC_2.NEF", "_Rejected/DSC_1.NEF"]);
    expect(listed(rt)).toEqual(["DSC_1.JPG", "DSC_2.NEF"]);
    await rt.dispatch("history.undo");

    // Separate photos keep separate sidecars: the JPEG leaves DSC_1.xmp to the RAW.
    const sync = new MetadataSync(rt.store, rt.services, { debounceMs: 1, onError: () => undefined });
    sync.start();
    await rt.dispatch("library.rating.set", { rating: 4, photoIds: ["DSC_1.JPG"] });
    await sync.flush();
    sync.stop();
    expect(source.files.has("DSC_1.JPG.xmp")).toBe(true);
    expect(source.files.has("DSC_1.xmp")).toBe(false); // the RAW's sidecar slot is untouched
    expect(parseXmp((await source.readSidecar("DSC_1.JPG"))!.text)).toMatchObject({ rating: 4 });
    expect(await source.readSidecar("DSC_1.NEF")).toBeNull();

    // Grouping again: a selected JPEG stands for its RAW.
    await rt.dispatch("library.selection.set", { ids: ["DSC_1.JPG", "DSC_2.NEF"] });
    await rt.dispatch("library.pairs.set", { grouped: true });
    expect(listed(rt)).toEqual(["DSC_1.NEF", "DSC_2.NEF"]);
    expect(rt.store.getState().selection).toEqual({ activeId: "DSC_1.NEF", ids: ["DSC_1.NEF", "DSC_2.NEF"] });
  });
});
