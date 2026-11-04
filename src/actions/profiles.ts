import { z } from "zod";
import { defineAction, type AppContext } from "../core/actions/types";
import { hasSelection, when } from "../core/actions/when";
import {
  BUILTIN_PROFILES,
  findProfile,
  isBuiltInId,
  mergeLook,
  newProfileId,
  partialLookSchema,
  profileFile,
  profileFileSchema,
  profileGroup,
  profileSchema,
  slug,
  uniqueName,
  type Profile,
} from "../core/develop/profiles";
import { lookSchema, neutralLook } from "../core/develop/recipe";
import type { AppState } from "../core/state/types";
import { targetIds } from "./context";
import { editOf, photoIds, updateEdits } from "./develop";

const userProfiles = (s: AppState) => s.develop.profiles;

function requireProfile(ctx: AppContext, id: string): Profile {
  const p = findProfile(id, userProfiles(ctx.state));
  if (!p) throw new Error(`Unknown profile "${id}". Use develop.profiles.list to see the available ones.`);
  return p;
}

function requireUserProfile(ctx: AppContext, id: string): Profile {
  const p = requireProfile(ctx, id);
  if (isBuiltInId(p.id)) throw new Error(`"${p.name}" is a built-in profile and can't be changed; create a copy with develop.profiles.create { from: "${p.id}" }.`);
  return p;
}

/** Photos in the open folder that use a profile. */
const photosUsing = (s: AppState, id: string) => s.photos.order.filter((pid) => s.photos.byId[pid]?.edit?.profile?.id === id);

const profileId = z.string().min(1).describe("Profile id, from develop.profiles.list.");

/** "user.faded-print-copy" → "Faded Print Copy", for history labels (which can't see the profile's name). */
const titleFromId = (id: string) =>
  id
    .replace(/^user\./, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

// ── Applying ─────────────────────────────────────────────────────────────

export const setProfile = defineAction({
  id: "develop.profile.set",
  title: "Set Profile",
  description:
    "Apply a profile (a film look under the sliders: colour or black and white, curves, toning, grain) to the " +
    'selected photos, or "none" to remove it. The sliders are kept. amount is its strength in percent (0–200, ' +
    "default 100); amount alone changes the strength of each photo's current profile. Ids come from " +
    "develop.profiles.list.",
  category: "Develop",
  kind: "command",
  undoable: true,
  when: hasSelection,
  params: z
    .object({
      profileId: z.string().min(1).optional().describe('Profile id from develop.profiles.list, or "none" to remove the profile.'),
      amount: z.number().min(0).max(200).optional().describe("Strength in percent, 0–200 (100 is the profile as designed)."),
      photoIds,
    })
    .refine((p) => p.profileId !== undefined || p.amount !== undefined, "Give profileId, amount, or both."),
  examples: [
    { params: { profileId: "builtin.classic-bw" }, description: "Classic black and white." },
    { params: { profileId: "builtin.faded-print", amount: 60 }, description: "A lighter faded-print look." },
    { params: { amount: 140 }, description: "Strengthen each photo's current profile." },
    { params: { profileId: "none" }, description: "Remove the profile." },
  ],
  label: (p) =>
    p.profileId === "none"
      ? "Remove Profile"
      : p.profileId
        ? `Profile: ${findProfile(p.profileId, [])?.name ?? titleFromId(p.profileId)}`
        : `Profile Amount ${Math.round(p.amount!)}`,
  coalesce: (p) => `develop.profile:${p.profileId ?? ""}:${p.photoIds?.join("|") ?? ""}`,
  run(p, ctx) {
    const ids = targetIds(ctx.state, p.photoIds);
    if (p.profileId === "none") {
      updateEdits(ctx, ids, (r) => {
        const { profile: _, ...rest } = r;
        return rest;
      });
      return;
    }
    const profile = p.profileId ? requireProfile(ctx, p.profileId) : null;
    const amount = p.amount === undefined ? undefined : Math.round(p.amount);
    updateEdits(ctx, ids, (r) => {
      if (profile) {
        // A different profile starts at 100% (as in Lightroom); the same one keeps its amount.
        const keep = r.profile?.id === profile.id ? r.profile.amount : 100;
        return { ...r, profile: { id: profile.id, name: profile.name, amount: amount ?? keep, look: structuredClone(profile.look) } };
      }
      return r.profile ? { ...r, profile: { ...r.profile, amount: amount! } } : r;
    });
  },
});

// ── Library of profiles ──────────────────────────────────────────────────

export const listProfiles = defineAction({
  id: "develop.profiles.list",
  title: "List Profiles",
  description:
    "List the available profiles: built-in film looks and the user's own, with id, name, group (color or bw), " +
    "description, and how many photos in this folder use each. Pass includeLooks for their full settings.",
  category: "Develop",
  kind: "query",
  params: z.object({ includeLooks: z.boolean().optional().describe("Include each profile's look (curves, toning, grain…).") }).optional(),
  examples: [{ params: {}, description: "All profiles." }],
  run(p, ctx) {
    const s = ctx.state;
    const usage = new Map<string, number>();
    for (const id of s.photos.order) {
      const pid = s.photos.byId[id]?.edit?.profile?.id;
      if (pid) usage.set(pid, (usage.get(pid) ?? 0) + 1);
    }
    const row = (prof: Profile, builtIn: boolean) => ({
      id: prof.id,
      name: prof.name,
      group: profileGroup(prof),
      builtIn,
      ...(prof.description ? { description: prof.description } : {}),
      photosUsing: usage.get(prof.id) ?? 0,
      ...(p?.includeLooks ? { look: prof.look } : {}),
    });
    return { profiles: [...BUILTIN_PROFILES.map((x) => row(x, true)), ...userProfiles(s).map((x) => row(x, false))] };
  },
});

export const getProfile = defineAction({
  id: "develop.profiles.get",
  title: "Get Profile",
  description: "Return one profile's full definition (name, description, look), built-in or the user's own.",
  category: "Develop",
  kind: "query",
  params: z.object({ id: profileId }),
  examples: [{ params: { id: "builtin.sepia" }, description: "The Sepia profile's settings." }],
  run({ id }, ctx) {
    const p = requireProfile(ctx, id);
    return { ...p, group: profileGroup(p), builtIn: isBuiltInId(p.id) };
  },
});

export const createProfile = defineAction({
  id: "develop.profiles.create",
  title: "New Profile",
  description:
    "Create one of the user's own profiles. It starts from another profile's look (from), else the active " +
    "photo's current profile, else neutral; look then changes any fields. Returns the new id. Use " +
    "develop.profile.set to apply it.",
  category: "Develop",
  kind: "command",
  undoable: true,
  params: z.object({
    name: z.string().trim().min(1).max(60).describe("Name shown in the profile browser."),
    description: z.string().max(300).optional().describe("What the look is like."),
    from: z.string().min(1).optional().describe("Copy this profile's look (id)."),
    look: partialLookSchema.optional(),
  }),
  examples: [
    { params: { name: "My Sepia", from: "builtin.sepia", look: { fade: 15 } }, description: "A more faded copy of Sepia." },
    {
      params: { name: "Teal Shadows", look: { splitToning: { shadowHue: 185, shadowSaturation: 35 }, fade: 5 } },
      description: "A new look from scratch.",
    },
  ],
  label: (p) => `New Profile “${p.name}”`,
  targets: () => [],
  run(p, ctx) {
    const s = ctx.state;
    const activeLook = editOf(s.selection.activeId ? s.photos.byId[s.selection.activeId] : undefined).profile?.look;
    const base = p.from ? requireProfile(ctx, p.from).look : (activeLook ?? neutralLook());
    const taken = new Set([...BUILTIN_PROFILES, ...userProfiles(s)].map((x) => x.id));
    const name = uniqueName(p.name, userProfiles(s).map((x) => x.name));
    const profile: Profile = {
      id: newProfileId(name, taken),
      name,
      ...(p.description ? { description: p.description } : {}),
      look: p.look ? mergeLook(base, p.look) : structuredClone(base),
    };
    ctx.update((d) => {
      d.develop.profiles.push(profile);
    });
    return { id: profile.id, name: profile.name };
  },
});

export const updateProfile = defineAction({
  id: "develop.profiles.update",
  title: "Edit Profile",
  description:
    "Change one of the user's own profiles: rename it, change its description, or change look fields. Photos " +
    "in this folder that use it are updated too (photos elsewhere keep the look they were given until it is " +
    "applied again). Built-in profiles can't be changed.",
  category: "Develop",
  kind: "command",
  undoable: true,
  params: z.object({
    id: profileId,
    name: z.string().trim().min(1).max(60).optional().describe("New name."),
    description: z.string().max(300).optional().describe("New description."),
    look: partialLookSchema.optional(),
  }),
  examples: [
    { params: { id: "user.my-sepia", name: "Warm Sepia" }, description: "Rename a profile." },
    { params: { id: "user.my-sepia", look: { grain: { amount: 30 } } }, description: "More grain." },
  ],
  label: (p) => (p.name && !p.look ? `Rename Profile “${p.name}”` : "Edit Profile"),
  coalesce: (p) =>
    `develop.profiles.update:${p.id}:${p.name === undefined ? "" : "name"}:${Object.entries(p.look ?? {})
      .map(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? `${k}.${Object.keys(v).join(".")}` : k))
      .join(",")}`,
  targets: (p, ctx) => photosUsing(ctx.state, p.id),
  run(p, ctx) {
    const current = requireUserProfile(ctx, p.id);
    const name = p.name && p.name !== current.name ? uniqueName(p.name, userProfiles(ctx.state).filter((x) => x.id !== p.id).map((x) => x.name)) : current.name;
    const look = p.look ? mergeLook(current.look, p.look) : current.look;
    const users = photosUsing(ctx.state, p.id);
    ctx.update((d) => {
      const prof = d.develop.profiles.find((x) => x.id === p.id)!;
      prof.name = name;
      if (p.description !== undefined) {
        if (p.description) prof.description = p.description;
        else delete prof.description;
      }
      prof.look = structuredClone(look);
      for (const id of users) {
        const r = d.photos.byId[id]!.edit!;
        r.profile = { ...r.profile!, name, look: structuredClone(look) };
      }
    });
    return { id: p.id, name, photosUpdated: users.length };
  },
});

export const deleteProfile = defineAction({
  id: "develop.profiles.delete",
  title: "Delete Profile",
  description:
    "Delete one of the user's own profiles. Photos that use it keep their look (each edit holds a copy of it). " +
    "Undoable. Built-in profiles can't be deleted.",
  category: "Develop",
  kind: "command",
  undoable: true,
  params: z.object({ id: profileId }),
  examples: [{ params: { id: "user.my-sepia" }, description: "Delete a profile." }],
  label: (p) => `Delete Profile ${titleFromId(p.id)}`,
  targets: () => [],
  run({ id }, ctx) {
    const prof = requireUserProfile(ctx, id);
    ctx.update((d) => {
      d.develop.profiles = d.develop.profiles.filter((x) => x.id !== id);
    });
    return { deleted: prof.name, photosStillUsing: photosUsing(ctx.state, id).length };
  },
});

// ── Files ────────────────────────────────────────────────────────────────

export const exportProfiles = defineAction({
  id: "develop.profiles.export",
  sideEffects: true,
  title: "Export Profiles",
  description:
    "Save profiles to a JSON file on the user's disk (a download) to back them up or share them; " +
    "develop.profiles.import loads them back. Exports the given ids (built-in or the user's own), or all of " +
    "the user's own profiles.",
  category: "Develop",
  kind: "command",
  when: when("there are profiles to export", (ctx) => ctx.state.develop.profiles.length > 0),
  params: z.object({ ids: z.array(z.string().min(1)).min(1).optional().describe("Profiles to export. Omit for all of your own.") }).optional(),
  examples: [
    { params: {}, description: "Export all of your profiles." },
    { params: { ids: ["user.my-sepia"] }, description: "Export one profile to share." },
  ],
  run(p, ctx) {
    const profiles = p?.ids ? p.ids.map((id) => requireProfile(ctx, id)) : userProfiles(ctx.state);
    const fileName = profiles.length === 1 ? `${slug(profiles[0]!.name)}.profile.json` : "photo-profiles.json";
    ctx.services.downloads.save(fileName, JSON.stringify(profileFile(profiles), null, 2), "application/json");
    return { fileName, exported: profiles.length };
  },
});

export const importProfiles = defineAction({
  id: "develop.profiles.import",
  title: "Import Profiles",
  description:
    "Add the profiles in a profiles file (the parsed JSON written by develop.profiles.export) to the user's " +
    "own. A profile identical to an existing one is skipped; one whose id is already used is added as a copy " +
    "with a new name, unless replace is true, which overwrites it (and updates photos here that use it).",
  category: "Develop",
  kind: "command",
  undoable: true,
  params: z.object({
    file: profileFileSchema,
    replace: z.boolean().optional().describe("Overwrite your profiles that have the same id instead of adding copies."),
  }),
  examples: [
    {
      params: { file: { format: "photo-profiles", version: 1, profiles: [{ name: "Shared Look", look: lookSchema.parse({ fade: 10 }) }] } },
      description: "Import a profile.",
    },
  ],
  label: (p) => `Import ${p.file.profiles.length === 1 ? `Profile “${p.file.profiles[0]!.name}”` : `${p.file.profiles.length} Profiles`}`,
  targets: () => [],
  run({ file, replace }, ctx) {
    const added: string[] = [];
    const replaced: string[] = [];
    const skipped: string[] = [];
    ctx.update((d) => {
      const list = d.develop.profiles;
      for (const incoming of file.profiles) {
        const look = lookSchema.parse(incoming.look);
        const existing = incoming.id && !isBuiltInId(incoming.id) ? list.find((x) => x.id === incoming.id) : undefined;
        if (existing && JSON.stringify(existing.look) === JSON.stringify(look) && existing.name === incoming.name) {
          skipped.push(existing.id);
          continue;
        }
        if (existing && replace) {
          existing.name = incoming.name;
          if (incoming.description) existing.description = incoming.description;
          else delete existing.description;
          existing.look = look;
          for (const id of d.photos.order) {
            const r = d.photos.byId[id]?.edit;
            if (r?.profile?.id === existing.id) r.profile = { ...r.profile, name: incoming.name, look: structuredClone(look) };
          }
          replaced.push(existing.id);
          continue;
        }
        const taken = new Set([...BUILTIN_PROFILES, ...list].map((x) => x.id));
        const name = uniqueName(incoming.name, list.map((x) => x.name));
        const id = incoming.id && !taken.has(incoming.id) && incoming.id.startsWith("user.") ? incoming.id : newProfileId(name, taken);
        list.push({ id, name, ...(incoming.description ? { description: incoming.description } : {}), look });
        added.push(id);
      }
    });
    return { added, replaced, skipped };
  },
});

/** Settings key for the user's profiles (written by ui/develop/profile-sync.ts). */
export const PROFILES_SETTINGS_KEY = "develop.profiles";

export const loadProfiles = defineAction({
  id: "develop.profiles.load",
  internal: true,
  title: "Load Profiles",
  description: "Restore the user's profiles from local settings at startup. Invalid entries are dropped.",
  category: "Develop",
  kind: "command",
  params: z.object({ profiles: z.array(z.unknown()).describe("Stored profiles.") }),
  examples: [{ params: { profiles: [] }, description: "No saved profiles." }],
  run({ profiles }, ctx) {
    const valid = profiles.flatMap((p) => {
      const r = profileSchema.safeParse(p);
      return r.success && !isBuiltInId(r.data.id) ? [r.data] : [];
    });
    ctx.update((d) => {
      d.develop.profiles = valid;
    });
    return { loaded: valid.length, dropped: profiles.length - valid.length };
  },
});

export const profileActions = [
  setProfile,
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  exportProfiles,
  importProfiles,
  loadProfiles,
];
