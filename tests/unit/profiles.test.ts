import { describe, expect, it } from "vitest";
import { autoSettings, autoWhiteBalance, samplePixels } from "../../src/core/develop/auto";
import { grainNoise, processPixel, uniformsFor, LUMA } from "../../src/core/develop/pipeline";
import { BUILTIN_PROFILES, findProfile, mergeLook, newProfileId, profileFileSchema, uniqueName } from "../../src/core/develop/profiles";
import { DEFAULT_CROP, defaultRecipe, isDefaultRecipe, lookSchema, mergeGroups, neutralLook, recipeSchema, type EditRecipe } from "../../src/core/develop/recipe";
import { createTestRuntime, FakePreviews, makeImage, solidImage } from "./helpers";

const withProfile = (id: string, amount = 100): EditRecipe => {
  const p = findProfile(id, [])!;
  return { ...defaultRecipe(), profile: { id: p.id, name: p.name, amount, look: p.look } };
};
const luma = ([r, g, b]: [number, number, number]) => r * LUMA[0] + g * LUMA[1] + b * LUMA[2];

describe("profile looks", () => {
  it("built-ins are valid, uniquely named and grouped", () => {
    expect(BUILTIN_PROFILES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(BUILTIN_PROFILES.map((p) => p.id)).size).toBe(BUILTIN_PROFILES.length);
    for (const p of BUILTIN_PROFILES) expect(lookSchema.safeParse(p.look).success).toBe(true);
  });

  it("a neutral look at any amount changes nothing", () => {
    const r: EditRecipe = { ...defaultRecipe(), profile: { id: "user.x", name: "x", amount: 200, look: neutralLook() } };
    const u = uniformsFor(r);
    for (const c of [[0.1, 0.5, 0.9], [0.8, 0.2, 0.3]] as const) {
      processPixel(c[0], c[1], c[2], u).forEach((v, i) => expect(Math.abs(v - c[i]!)).toBeLessThan(1.5 / 255));
    }
  });

  it("black and white profiles are grey; amount 0 is no change", () => {
    const [r, g, b] = processPixel(0.8, 0.3, 0.2, uniformsFor(withProfile("builtin.classic-bw")));
    expect(Math.abs(r - g)).toBeLessThan(1e-6);
    expect(Math.abs(g - b)).toBeLessThan(1e-6);
    const off = processPixel(0.8, 0.3, 0.2, uniformsFor(withProfile("builtin.classic-bw", 0)));
    off.forEach((v, i) => expect(Math.abs(v - [0.8, 0.3, 0.2][i]!)).toBeLessThan(1.5 / 255));
  });

  it("sepia tints shadows warm; fade lifts black", () => {
    const [r, , b] = processPixel(0.2, 0.2, 0.2, uniformsFor(withProfile("builtin.sepia")));
    expect(r).toBeGreaterThan(b);
    expect(luma(processPixel(0, 0, 0, uniformsFor(withProfile("builtin.faded-print"))))).toBeGreaterThan(0.03);
  });

  it("grain noise is deterministic, bounded and centred", () => {
    let sum = 0;
    for (let i = 0; i < 2000; i++) {
      const n = grainNoise((i % 50) / 50 + 0.003, Math.floor(i / 50) / 40, 1.5, 1200);
      expect(Math.abs(n)).toBeLessThanOrEqual(0.5);
      sum += n;
    }
    expect(Math.abs(sum / 2000)).toBeLessThan(0.05);
    expect(grainNoise(0.31, 0.62, 1.5, 1200)).toBe(grainNoise(0.31, 0.62, 1.5, 1200));
  });

  it("partial looks merge field by field", () => {
    const base = findProfile("builtin.sepia", [])!.look;
    const m = mergeLook(base, { grain: { amount: 50 }, splitToning: { balance: 20 } });
    expect(m.grain).toEqual({ amount: 50, size: base.grain.size });
    expect(m.splitToning).toMatchObject({ balance: 20, shadowHue: base.splitToning.shadowHue });
    expect(m.monochrome).toEqual(base.monochrome);
  });

  it("names and ids are made unique", () => {
    expect(uniqueName("Moody", ["moody", "Moody 2"])).toBe("Moody 3");
    expect(newProfileId("Moody Teal!", new Set(["user.moody-teal"]))).toBe("user.moody-teal-2");
  });
});

describe("recipes with profiles", () => {
  it("still parse without a profile, and profile is its own settings group", () => {
    const { profile: _, ...old } = withProfile("builtin.matte");
    expect(recipeSchema.parse(old).profile).toBeUndefined();
    expect(recipeSchema.parse(withProfile("builtin.matte")).profile?.id).toBe("builtin.matte");
    // Copying the profile group from an unprofiled recipe removes it, leaving an unedited recipe.
    expect(isDefaultRecipe(mergeGroups(withProfile("builtin.matte"), defaultRecipe(), ["profile"]))).toBe(true);
  });
});

describe("profile actions", () => {
  const editOf = (rt: Awaited<ReturnType<typeof createTestRuntime>>, id = "DSC_0001.jpg") => rt.store.getState().photos.byId[id]!.edit;

  it("sets a profile on the selection, keeps sliders, and changes amount alone", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("library.selection.set", { ids: ["DSC_0001.jpg", "DSC_0002.jpg"] });
    await rt.dispatch("develop.adjust", { setting: "exposure", value: 0.5 });
    expect(await rt.dispatch("develop.profile.set", { profileId: "builtin.sepia" })).toMatchObject({ ok: true });
    expect(editOf(rt)).toMatchObject({ exposure: 0.5, profile: { id: "builtin.sepia", name: "Sepia", amount: 100 } });
    await rt.dispatch("develop.profile.set", { amount: 60 });
    expect(editOf(rt, "DSC_0002.jpg")!.profile!.amount).toBe(60);
    await rt.dispatch("develop.profile.set", { profileId: "builtin.matte" });
    expect(editOf(rt)!.profile).toMatchObject({ id: "builtin.matte", amount: 100 });
    await rt.dispatch("develop.profile.set", { profileId: "none" });
    expect(editOf(rt)!.profile).toBeUndefined();
    expect(await rt.dispatch("develop.profile.set", { profileId: "builtin.nope" })).toMatchObject({ ok: false, error: "failed" });
  });

  it("an amount drag is one undo step", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("develop.profile.set", { profileId: "builtin.vivid-slide" });
    for (const a of [90, 80, 70]) await rt.dispatch("develop.profile.set", { amount: a }, { source: "ui" });
    expect(rt.history.entries).toHaveLength(2);
    await rt.dispatch("history.undo");
    expect(editOf(rt)!.profile!.amount).toBe(100);
  });

  it("creates, edits (updating photos that use it), renames, deletes and undoes", async () => {
    const rt = await createTestRuntime();
    const created = await rt.dispatch<{ id: string }>("develop.profiles.create", { name: "My Sepia", from: "builtin.sepia", look: { fade: 20 } });
    expect(created).toMatchObject({ ok: true, value: { id: "user.my-sepia" } });
    const id = (created as { value: { id: string } }).value.id;
    expect(rt.store.getState().develop.profiles[0]!.look.fade).toBe(20);

    await rt.dispatch("library.selection.set", { ids: ["DSC_0001.jpg", "DSC_0002.jpg"] });
    await rt.dispatch("develop.profile.set", { profileId: id });
    await rt.dispatch("develop.profiles.update", { id, name: "Warm Sepia", look: { grain: { amount: 40 } } });
    expect(editOf(rt, "DSC_0002.jpg")!.profile).toMatchObject({ id, name: "Warm Sepia", look: { grain: { amount: 40 } } });

    // Built-ins can't be changed.
    expect(await rt.dispatch("develop.profiles.update", { id: "builtin.sepia", name: "x" })).toMatchObject({ ok: false });

    await rt.dispatch("develop.profiles.delete", { id });
    expect(rt.store.getState().develop.profiles).toHaveLength(0);
    // Photos keep their look.
    expect(editOf(rt)!.profile!.look.grain.amount).toBe(40);
    await rt.dispatch("history.undo");
    expect(rt.store.getState().develop.profiles.map((p) => p.name)).toEqual(["Warm Sepia"]);
  });

  it("dragging an editor slider is one undo step", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("develop.profiles.create", { name: "Grainy" });
    const before = rt.history.entries.length;
    for (const amount of [10, 20, 30]) await rt.dispatch("develop.profiles.update", { id: "user.grainy", look: { grain: { amount } } }, { source: "ui" });
    expect(rt.history.entries.length).toBe(before + 1);
  });

  it("new profiles start from the active photo's profile", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("develop.profile.set", { profileId: "builtin.selenium" });
    await rt.dispatch("develop.profiles.create", { name: "Mine" });
    expect(rt.store.getState().develop.profiles[0]!.look).toEqual(findProfile("builtin.selenium", [])!.look);
  });

  it("exports to a file that imports back; duplicates are skipped, clashes copied or replaced", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("develop.profiles.create", { name: "Teal", from: "builtin.cool-cinema" });
    expect(await rt.dispatch("develop.profiles.export")).toMatchObject({ ok: true, value: { fileName: "teal.profile.json", exported: 1 } });
    const file = JSON.parse(rt.downloads.at(-1)!.content);
    expect(profileFileSchema.safeParse(file).success).toBe(true);

    expect(await rt.dispatch("develop.profiles.import", { file })).toMatchObject({ ok: true, value: { added: [], skipped: ["user.teal"] } });

    file.profiles[0].look.fade = 33;
    expect(await rt.dispatch("develop.profiles.import", { file })).toMatchObject({ ok: true, value: { added: ["user.teal-2"] } });
    expect(rt.store.getState().develop.profiles.map((p) => p.name)).toEqual(["Teal", "Teal 2"]);

    file.profiles[0].look.fade = 44;
    expect(await rt.dispatch("develop.profiles.import", { file, replace: true })).toMatchObject({ ok: true, value: { replaced: ["user.teal"] } });
    expect(rt.store.getState().develop.profiles[0]!.look.fade).toBe(44);

    // In a fresh app, the file's ids are kept.
    const other = await createTestRuntime();
    await other.dispatch("develop.profiles.import", { file });
    expect(other.store.getState().develop.profiles.map((p) => p.id)).toEqual(["user.teal"]);
    expect(await other.dispatch("develop.profiles.import", { file: { format: "nope" } })).toMatchObject({ ok: false, error: "invalid_params" });
  });

  it("loads stored profiles, dropping invalid ones", async () => {
    const rt = await createTestRuntime();
    const good = { id: "user.a", name: "A", look: neutralLook() };
    await rt.dispatch("develop.profiles.load", { profiles: [good, { id: "user.b" }, { ...good, id: "builtin.sepia" }] });
    expect(rt.store.getState().develop.profiles.map((p) => p.id)).toEqual(["user.a"]);
  });

  it("lists built-in and user profiles with usage", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("develop.profile.set", { profileId: "builtin.matte" });
    await rt.dispatch("develop.profiles.create", { name: "Mine" });
    const r = await rt.dispatch<{ profiles: Array<{ id: string; photosUsing: number; builtIn: boolean; group: string }> }>("develop.profiles.list");
    if (!r.ok) throw new Error(r.message);
    expect(r.value.profiles.find((p) => p.id === "builtin.matte")).toMatchObject({ photosUsing: 1, builtIn: true, group: "color" });
    expect(r.value.profiles.find((p) => p.id === "builtin.sepia")).toMatchObject({ group: "bw" });
    expect(r.value.profiles.at(-1)).toMatchObject({ id: "user.mine", builtIn: false });
  });

  it("sync and copy include the profile by default", async () => {
    const rt = await createTestRuntime();
    await rt.dispatch("develop.profile.set", { profileId: "builtin.sepia" });
    await rt.dispatch("library.selection.set", { ids: ["DSC_0001.jpg", "DSC_0002.jpg"], activeId: "DSC_0001.jpg" });
    await rt.dispatch("develop.settings.sync");
    expect(editOf(rt, "DSC_0002.jpg")!.profile!.id).toBe("builtin.sepia");
  });
});

describe("auto", () => {
  const gradient = (lo: number, hi: number) => makeImage(64, 48, (x) => {
    const v = Math.round(lo + (hi - lo) * x);
    return [v, v, v];
  });

  it("brightens dark photos and darkens bright ones", () => {
    expect(autoSettings(gradient(5, 80), defaultRecipe(), ["tone"]).exposure!).toBeGreaterThan(0.5);
    expect(autoSettings(gradient(170, 255), defaultRecipe(), ["tone"]).exposure!).toBeLessThan(-0.3);
  });

  it("adds contrast to a flat photo", () => {
    expect(autoSettings(gradient(100, 150), defaultRecipe(), ["tone"]).contrast!).toBeGreaterThan(0);
  });

  it("leaves a well-exposed, full-range photo nearly alone", () => {
    const s = autoSettings(gradient(0, 255), defaultRecipe(), ["tone"]);
    expect(s.exposure).toBe(0);
    for (const k of ["whites", "blacks", "contrast", "highlights", "shadows"] as const) expect(Math.abs(s[k]!)).toBeLessThan(20);
  });

  it("brings the median into the mid-tone band and ignores the previous tone settings", () => {
    const img = gradient(10, 120);
    const a = autoSettings(img, defaultRecipe(), ["tone"]);
    const b = autoSettings(img, { ...defaultRecipe(), exposure: 3, contrast: -50 }, ["tone"]);
    expect(b).toEqual(a);
    const u = uniformsFor({ ...defaultRecipe(), ...a } as EditRecipe);
    const samples = samplePixels(img, DEFAULT_CROP);
    const out: number[] = [];
    for (let i = 0; i < samples.length; i += 3) out.push(luma(processPixel(samples[i]!, samples[i + 1]!, samples[i + 2]!, u)));
    out.sort((x, y) => x - y);
    const median = out[out.length >> 1]!;
    expect(median).toBeGreaterThan(0.29);
    expect(median).toBeLessThan(0.56);
  });

  it("doesn't blow out a bright area to brighten a dark photo", () => {
    // A dark room with a bright window: lifting the room to the band would clip the window.
    const img = makeImage(64, 48, (x, y) => (x > 0.6 && y < 0.4 ? [215, 215, 215] : [20, 20, 20]));
    const s = autoSettings(img, defaultRecipe(), ["tone"]);
    expect(s.exposure!).toBeGreaterThan(0);
    const u = uniformsFor({ ...defaultRecipe(), ...s } as EditRecipe);
    const samples = samplePixels(img, DEFAULT_CROP);
    let blown = 0;
    for (let i = 0; i < samples.length; i += 3) if (luma(processPixel(samples[i]!, samples[i + 1]!, samples[i + 2]!, u)) > 0.995) blown++;
    expect(blown / (samples.length / 3)).toBeLessThan(0.01);
  });

  it("neutralises a colour cast", () => {
    const blueish = makeImage(32, 32, (x, y) => {
      const v = 60 + 120 * x * y + 40 * x;
      return [v * 0.8, v * 0.95, v * 1.15];
    });
    const wb = autoWhiteBalance(samplePixels(blueish, DEFAULT_CROP));
    expect(wb.temperature).toBeGreaterThan(10); // warmer to cancel the blue
    expect(autoWhiteBalance(samplePixels(solidImage(120, 120, 120), DEFAULT_CROP))).toEqual({ temperature: 0, tint: 0 });
  });

  it("only looks inside the crop", () => {
    // Dark left half, bright right half: cropping to the right half sees a bright photo.
    const img = makeImage(64, 32, (x) => (x < 0.5 ? [15, 15, 15] : [200, 200, 200]));
    const right = autoSettings(img, { ...defaultRecipe(), crop: { ...DEFAULT_CROP, x: 0.5, width: 0.5 } }, ["tone"]);
    expect(right.exposure!).toBeLessThan(0);
  });

  it("develop.auto adjusts each selected photo separately, as one undo step", async () => {
    const previews = new FakePreviews();
    previews.pixels["DSC_0001.jpg"] = gradient(5, 70);
    previews.pixels["DSC_0002.jpg"] = gradient(160, 250);
    previews.pixels["DSC_0003.jpg"] = null;
    const rt = await createTestRuntime({ previews });
    await rt.dispatch("library.selection.set", { ids: ["DSC_0001.jpg", "DSC_0002.jpg", "DSC_0003.jpg"] });
    const r = await rt.dispatch<{ adjusted: number; failed: Array<{ photoId: string }> }>("develop.auto", { include: ["tone", "wb"] });
    expect(r).toMatchObject({ ok: true, value: { adjusted: 2, failed: [{ photoId: "DSC_0003.jpg" }] } });
    const byId = rt.store.getState().photos.byId;
    expect(byId["DSC_0001.jpg"]!.edit!.exposure).toBeGreaterThan(0);
    expect(byId["DSC_0002.jpg"]!.edit!.exposure).toBeLessThan(0);
    expect(byId["DSC_0003.jpg"]!.edit).toBeUndefined();
    expect(rt.history.getSnapshot().undoLabel).toBe("Auto Tone & White Balance");
    await rt.dispatch("history.undo");
    expect(rt.store.getState().photos.byId["DSC_0001.jpg"]!.edit).toBeUndefined();
    expect(rt.store.getState().photos.byId["DSC_0002.jpg"]!.edit).toBeUndefined();
  });

  it("accounts for the profile", async () => {
    const img = gradient(30, 160);
    const plain = autoSettings(img, defaultRecipe(), ["tone"]);
    const faded = autoSettings(img, withProfile("builtin.faded-print"), ["tone"]);
    expect(faded).not.toEqual(plain);
  });
});
