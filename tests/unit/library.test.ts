// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MemorySource } from "../../src/adapters/memory-source";
import { MetadataSync } from "../../src/core/library/metadata-sync";
import { selectVisibleIds } from "../../src/core/state/selectors";
import type { FolderInfo } from "../../src/core/state/types";
import { parseXmp, writeXmp } from "../../src/core/xmp/xmp";
import { buildRows } from "../../src/ui/palette/rows";
import { FakePreviews, createTestRuntime, settle } from "./helpers";

const folder = (canWriteSidecars = true): FolderInfo => ({ id: "f1", name: "Shoot", kind: "memory", canWriteSidecars });

function shoot(canWrite = true) {
  return new MemorySource(folder(canWrite), {
    "a/IMG_1.jpg": "x",
    "a/IMG_2.jpg": "xx",
    "b/IMG_3.png": "xxx",
    "notes.txt": "ignored",
    "a/IMG_2.xmp": writeXmp(null, { rating: 4, flag: "pick", colorLabel: "green" }),
  });
}

async function openShoot(opts: { canWrite?: boolean; previews?: FakePreviews } = {}) {
  const rt = await createTestRuntime({ loadSample: false, previews: opts.previews });
  const source = shoot(opts.canWrite ?? true);
  rt.library.nextPick = source;
  const r = await rt.dispatch<{ count: number }>("library.folder.open");
  expect(r).toMatchObject({ ok: true, value: { count: 3 } });
  return { rt, source };
}

describe("opening a folder", () => {
  it("lists images by path, reads sidecars, and selects the first photo", async () => {
    const { rt } = await openShoot();
    const s = rt.store.getState();
    expect(s.photos.order).toEqual(["a/IMG_1.jpg", "a/IMG_2.jpg", "b/IMG_3.png"]);
    expect(s.photos.byId["a/IMG_2.jpg"]).toMatchObject({ rating: 4, flag: "pick", colorLabel: "green" });
    expect(s.selection.activeId).toBeTruthy();
    expect(s.library.folder?.name).toBe("Shoot");
  });

  it("returns cancelled when the picker is dismissed", async () => {
    const rt = await createTestRuntime({ loadSample: false });
    expect(await rt.dispatch("library.folder.open")).toMatchObject({ ok: true, value: { cancelled: true } });
  });

  it("indexes EXIF in the background and caches it for next time", async () => {
    const previews = new FakePreviews({
      "a/IMG_1.jpg": { capturedAt: "2026-09-12T08:00:00", width: 6000, height: 4000, exif: { model: "X-T5", iso: 400 } },
    });
    const { rt, source } = await openShoot({ previews });
    await settle(50);
    const s = rt.store.getState();
    expect(s.library.status).toEqual({ kind: "ready" });
    expect(s.photos.byId["a/IMG_1.jpg"]).toMatchObject({ capturedAt: "2026-09-12T08:00:00", width: 6000, indexed: true });

    // Reopening uses the cached index: nothing to read.
    let reads = 0;
    previews.readIndexData = async () => (reads++, {});
    rt.library.nextPick = source;
    await rt.dispatch("library.folder.open");
    expect(rt.store.getState().photos.byId["a/IMG_1.jpg"]!.exif).toEqual({ model: "X-T5", iso: 400 });
    expect(reads).toBe(0);
  });

  it("clears undo history, since entries refer to the previous folder", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("library.rating.set", { rating: 2 });
    expect(rt.history.canUndo).toBe(true);
    rt.library.nextPick = shoot();
    await rt.dispatch("library.folder.open");
    expect(rt.history.canUndo).toBe(false);
  });

  it("asks to reconnect when permission has lapsed", async () => {
    const rt = await createTestRuntime({ loadSample: false });
    rt.library.restore = { needsPermission: folder() };
    await rt.dispatch("library.folder.restore");
    expect(rt.store.getState().library.status).toMatchObject({ kind: "needsPermission" });
    expect(rt.dispatcher.isAvailable("library.folder.reconnect")).toBe(true);
  });
});

describe("saving ratings", () => {
  async function withSync(canWrite = true) {
    const ctx = await openShoot({ canWrite });
    const errors: string[] = [];
    const sync = new MetadataSync(ctx.rt.store, ctx.rt.services, { debounceMs: 1, onError: (m) => errors.push(m) });
    sync.start();
    return { ...ctx, sync, errors };
  }

  it("writes changes to app storage and XMP sidecars, preserving other sidecar content", async () => {
    const { rt, source, sync } = await withSync();
    source.files.set("a/IMG_1.xmp", { data: new Blob([`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="me"/></rdf:RDF></x:xmpmeta>`]), lastModified: 1 });
    await rt.dispatch("library.selection.set", { ids: ["a/IMG_1.jpg", "b/IMG_3.png"] });
    await rt.dispatch("library.rating.set", { rating: 5 });
    await sync.flush();

    const stored = await rt.services.metadata.load("f1");
    expect(stored.get("a/IMG_1.jpg")).toMatchObject({ rating: 5 });
    const sidecar1 = (await source.readSidecar("a/IMG_1.jpg"))!.text;
    expect(parseXmp(sidecar1)).toMatchObject({ rating: 5 });
    expect(sidecar1).toContain('dc:creator="me"');
    expect(parseXmp((await source.readSidecar("b/IMG_3.png"))!.text)).toMatchObject({ rating: 5 }); // new IMG_3.xmp
    expect(source.files.has("b/IMG_3.xmp")).toBe(true);
  });

  it("undo is persisted too", async () => {
    const { rt, source, sync } = await withSync();
    await rt.dispatch("library.selection.set", { ids: ["a/IMG_1.jpg"] });
    await rt.dispatch("library.flag.set", { flag: "reject" });
    await sync.flush();
    await rt.dispatch("history.undo");
    await sync.flush();
    expect(parseXmp((await source.readSidecar("a/IMG_1.jpg"))!.text)).toMatchObject({ flag: "none" });
  });

  it("does not write anything when a folder is loaded", async () => {
    const { source, sync } = await withSync();
    await sync.flush();
    expect(source.writes).toBe(0);
  });

  it("keeps read-only folders' ratings in app storage only", async () => {
    const { rt, source, sync, errors } = await withSync(false);
    await rt.dispatch("library.rating.set", { rating: 3 });
    await sync.flush();
    expect(source.writes).toBe(0);
    expect(errors).toEqual([]);
    expect((await rt.services.metadata.load("f1")).size).toBeGreaterThan(0);
  });

  it("never overwrites a corrupt sidecar, and reports it", async () => {
    const { rt, source, sync, errors } = await withSync();
    source.files.set("a/IMG_1.xmp", { data: new Blob(["<x:xmpmeta><broken"]), lastModified: 1 });
    await rt.dispatch("library.selection.set", { ids: ["a/IMG_1.jpg"] });
    await rt.dispatch("library.rating.set", { rating: 1 });
    await sync.flush();
    expect(await source.files.get("a/IMG_1.xmp")!.data.text()).toBe("<x:xmpmeta><broken");
    expect(errors[0]).toMatch(/XMP sidecar/);
  });

  it("a sidecar edited elsewhere after our last save wins on reload", async () => {
    const { rt, source, sync } = await withSync();
    await rt.dispatch("library.selection.set", { ids: ["a/IMG_1.jpg"] });
    await rt.dispatch("library.rating.set", { rating: 2 });
    await sync.flush();
    source.files.set("a/IMG_1.xmp", {
      data: new Blob([writeXmp(null, { rating: 5, flag: "none", colorLabel: "none" })]),
      lastModified: Date.now() + 1000,
    });
    rt.library.nextPick = source;
    await rt.dispatch("library.folder.open");
    expect(rt.store.getState().photos.byId["a/IMG_1.jpg"]!.rating).toBe(5);
  });
});

describe("filter and sort", () => {
  it("filters what is shown; navigation and select-all follow it", async () => {
    const rt = await createTestRuntime({ photos: 6 });
    await rt.dispatch("library.rating.set", { rating: 4, photoIds: ["DSC_0002.jpg", "DSC_0005.jpg"] });
    await rt.dispatch("library.filter.set", { minRating: 4 });
    expect(selectVisibleIds(rt.store.getState())).toEqual(["DSC_0002.jpg", "DSC_0005.jpg"]);

    await rt.dispatch("navigation.first");
    await rt.dispatch("navigation.next");
    expect(rt.store.getState().selection.activeId).toBe("DSC_0005.jpg");
    await rt.dispatch("library.selection.all");
    expect(rt.store.getState().selection.ids).toEqual(["DSC_0002.jpg", "DSC_0005.jpg"]);

    await rt.dispatch("library.filter.clear");
    expect(selectVisibleIds(rt.store.getState())).toHaveLength(6);
  });

  it("merges partial filter updates", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("library.filter.set", { minRating: 2 });
    await rt.dispatch("library.filter.set", { flags: ["pick"] });
    expect(rt.store.getState().library.filter).toMatchObject({ minRating: 2, flags: ["pick"] });
  });

  it("sorts", async () => {
    const rt = await createTestRuntime({ photos: 3 });
    await rt.dispatch("library.sort.set", { key: "capturedAt", direction: "desc" });
    expect(selectVisibleIds(rt.store.getState())[0]).toBe("DSC_0003.jpg");
  });

  it("queries by capture-time range independently of the screen filter", async () => {
    const rt = await createTestRuntime({ photos: 10 }); // 06:30 + 97s steps
    await rt.dispatch("library.filter.set", { minRating: 5 }); // hides everything
    const r = await rt.dispatch<{ total: number }>("library.photos.list", { capturedBefore: "2026-09-12T06:33" });
    expect(r).toMatchObject({ ok: true, value: { total: 2 } });
  });
});

describe("colour labels", () => {
  it("toggles like Lightroom's 6–9 keys", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("library.colorLabel.toggle", { label: "red" });
    expect(rt.store.getState().photos.byId["DSC_0001.jpg"]!.colorLabel).toBe("red");
    await rt.dispatch("library.colorLabel.toggle", { label: "red" });
    expect(rt.store.getState().photos.byId["DSC_0001.jpg"]!.colorLabel).toBe("none");
  });
});

describe("auto-advance", () => {
  const active = (rt: Awaited<ReturnType<typeof createTestRuntime>>) => rt.store.getState().selection.activeId;

  it("advances on interactive culling while Caps Lock is on (default mode)", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("library.rating.set", { rating: 3 }, { source: "keyboard" });
    expect(active(rt)).toBe("DSC_0001.jpg");
    rt.input.capsLock = true;
    await rt.dispatch("library.rating.set", { rating: 3 }, { source: "keyboard" });
    expect(active(rt)).toBe("DSC_0002.jpg");
    await rt.dispatch("library.flag.set", { flag: "pick" }, { source: "menu" });
    expect(active(rt)).toBe("DSC_0003.jpg");
  });

  it("never auto-advances for AI or scripts unless asked", async () => {
    const rt = await createTestRuntime();
    rt.input.capsLock = true;
    await rt.dispatch("app.autoAdvance.set", { mode: "always" });
    await rt.dispatch("library.rating.set", { rating: 3 }, { source: "ai" });
    expect(active(rt)).toBe("DSC_0001.jpg");
    await rt.dispatch("library.rating.set", { rating: 3, advance: true }, { source: "ai" });
    expect(active(rt)).toBe("DSC_0002.jpg");
  });

  it("follows the always/never modes and skips multi-photo selections", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("app.autoAdvance.set", { mode: "always" });
    await rt.dispatch("library.colorLabel.toggle", { label: "blue" }, { source: "keyboard" });
    expect(active(rt)).toBe("DSC_0002.jpg");

    await rt.dispatch("library.selection.set", { ids: ["DSC_0004.jpg", "DSC_0005.jpg"] });
    await rt.dispatch("library.rating.set", { rating: 1 }, { source: "keyboard" });
    expect(active(rt)).toBe("DSC_0004.jpg");

    await rt.dispatch("app.autoAdvance.set", { mode: "never" });
    rt.input.capsLock = true;
    await rt.dispatch("library.selection.set", { ids: ["DSC_0004.jpg"] });
    await rt.dispatch("library.rating.set", { rating: 1 }, { source: "keyboard" });
    expect(active(rt)).toBe("DSC_0004.jpg");
    expect(await rt.services.settings.get("app.autoAdvance")).toBe("never");
  });

  it("undo reverts the rating; the move is not an undo step", async () => {
    const rt = await createTestRuntime();
    rt.input.capsLock = true;
    await rt.dispatch("library.rating.set", { rating: 5 }, { source: "keyboard" });
    await rt.dispatch("history.undo");
    expect(rt.store.getState().photos.byId["DSC_0001.jpg"]!.rating).toBe(0);
    expect(active(rt)).toBe("DSC_0002.jpg");
  });
});

describe("context menus", () => {
  it("opens the current view's photo menu by default", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("app.contextMenu.open");
    expect(rt.store.getState().contextMenu).toEqual({ menuId: "grid.photo", x: null, y: null });
    await rt.dispatch("app.contextMenu.close");
    await rt.dispatch("view.set", { view: "loupe" });
    await rt.dispatch("app.contextMenu.open", { x: 10, y: 20 });
    expect(rt.store.getState().contextMenu).toEqual({ menuId: "loupe.photo", x: 10, y: 20 });
  });

  it("rejects unknown menus", async () => {
    const rt = await createTestRuntime();
    expect(await rt.dispatch("app.contextMenu.open", { menuId: "nope" })).toMatchObject({ ok: false, error: "failed" });
  });

  it("keyboard Shift+F10 opens it; modal mode then suppresses app shortcuts", async () => {
    const rt = await createTestRuntime();
    rt.keybindings.handleKeyDown({ key: "F10", shiftKey: true, metaKey: false, ctrlKey: false, altKey: false, preventDefault() {} });
    await settle(1);
    expect(rt.store.getState().contextMenu).not.toBeNull();
  });
});

describe("internal actions", () => {
  it("are dispatchable but hidden from the palette", async () => {
    const rt = await createTestRuntime();
    const rows = buildRows(rt.registry, rt.keybindings, rt.dispatcher.readonlyContext());
    expect(rows.some((r) => r.action.internal)).toBe(false);
    expect(rt.registry.get("library.index.apply")?.internal).toBe(true);
  });
});
