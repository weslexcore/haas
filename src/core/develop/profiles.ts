import { z } from "zod";
import { curvePoint, lookSchema, type Look } from "./recipe";

/**
 * Profiles: named looks applied under the develop sliders, with an amount
 * (see pipeline.ts, step 6). Built-in profiles ship with the app; the user's
 * own live in the store (state.develop.profiles) and in local settings, and
 * can be exported to and imported from JSON files.
 */

export const profileSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(300).optional(),
  look: lookSchema,
});

export type Profile = z.infer<typeof profileSchema>;
export type ProfileGroup = "color" | "bw";

export const profileGroup = (p: { look: Look }): ProfileGroup => (p.look.monochrome ? "bw" : "color");

/** The file written by develop.profiles.export and read by develop.profiles.import. */
export const PROFILE_FILE_FORMAT = "photo-profiles";

export const profileFileSchema = z
  .object({
    format: z.literal(PROFILE_FILE_FORMAT).describe(`Always "${PROFILE_FILE_FORMAT}".`),
    version: z.literal(1).describe("File format version, 1."),
    profiles: z
      .array(profileSchema.extend({ id: z.string().min(1).max(80).optional() }))
      .min(1)
      .max(500)
      .describe("Profiles: name, optional id and description, and look."),
  })
  .describe("The contents of a profiles file (as exported).");

export type ProfileFile = z.infer<typeof profileFileSchema>;

export function profileFile(profiles: readonly Profile[]): ProfileFile {
  return { format: PROFILE_FILE_FORMAT, version: 1, profiles: profiles.map(({ id, name, description, look }) => ({ id, name, ...(description ? { description } : {}), look })) };
}

/** Partial look for develop.profiles.update / create: given fields replace the profile's. */
export const partialLookSchema = z
  .object({
    curves: z
      .object({ red: z.array(curvePoint).min(2).max(16), green: z.array(curvePoint).min(2).max(16), blue: z.array(curvePoint).min(2).max(16) })
      .partial()
      .optional()
      .describe("Channel curves to replace (red, green, blue): control points [input, output] in 0–1."),
    monochrome: z
      .object({ red: z.number().min(-200).max(200), green: z.number().min(-200).max(200), blue: z.number().min(-200).max(200) })
      .nullable()
      .optional()
      .describe("Black and white channel mix in percent (red, green, blue), or null to make the look colour."),
    saturation: z.number().min(-100).max(100).optional().describe("Saturation, -100 to 100."),
    fade: z.number().min(0).max(100).optional().describe("Faded blacks, 0 to 100."),
    splitToning: z
      .object({
        shadowHue: z.number().min(0).max(360),
        shadowSaturation: z.number().min(0).max(100),
        highlightHue: z.number().min(0).max(360),
        highlightSaturation: z.number().min(0).max(100),
        balance: z.number().min(-100).max(100),
      })
      .partial()
      .optional()
      .describe("Split toning fields to change: hues in degrees, saturations 0–100, balance -100 to 100."),
    grain: z.object({ amount: z.number().min(0).max(100), size: z.number().min(0).max(100) }).partial().optional().describe("Grain amount and size, 0–100."),
  })
  .describe("Look fields to change; anything omitted is kept.");

export type PartialLook = z.infer<typeof partialLookSchema>;

export function mergeLook(base: Look, p: PartialLook): Look {
  const out = structuredClone(base);
  if (p.curves) Object.assign(out.curves, p.curves);
  if (p.monochrome !== undefined) out.monochrome = p.monochrome;
  if (p.saturation !== undefined) out.saturation = p.saturation;
  if (p.fade !== undefined) out.fade = p.fade;
  if (p.splitToning) Object.assign(out.splitToning, p.splitToning);
  if (p.grain) Object.assign(out.grain, p.grain);
  return out;
}

const BUILTIN_PREFIX = "builtin.";
export const USER_PREFIX = "user.";

export const isBuiltInId = (id: string) => id.startsWith(BUILTIN_PREFIX);

export const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "profile";

/** A new user profile id from its name, unique among `taken`. */
export function newProfileId(name: string, taken: ReadonlySet<string>): string {
  const base = USER_PREFIX + slug(name);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** A name not already used, by adding " 2", " 3", …. */
export function uniqueName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) if (!used.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
}

type LookInput = z.input<typeof lookSchema>;

const builtIn = (id: string, name: string, description: string, look: LookInput): Profile => ({
  id: BUILTIN_PREFIX + id,
  name,
  description,
  look: lookSchema.parse(look),
});

const s = (lift: number, roll: number): Array<[number, number]> => [
  [0, 0],
  [0.25, 0.25 - lift],
  [0.75, 0.75 + roll],
  [1, 1],
];
const all = (points: Array<[number, number]>) => ({ red: points, green: points, blue: points });
const NEUTRAL_MIX = { red: 30, green: 59, blue: 11 };

export const BUILTIN_PROFILES: readonly Profile[] = [
  builtIn("warm-portrait", "Warm Portrait", "Soft, warm colour with gentle contrast and creamy highlights; flattering on skin.", {
    curves: {
      red: [[0, 0.02], [0.5, 0.53], [1, 1]],
      green: [[0, 0.01], [0.5, 0.5], [1, 0.98]],
      blue: [[0, 0.04], [0.5, 0.47], [1, 0.93]],
    },
    saturation: -8,
    fade: 4,
    splitToning: { shadowHue: 25, shadowSaturation: 10, highlightHue: 40, highlightSaturation: 14 },
    grain: { amount: 10, size: 30 },
  }),
  builtIn("vivid-slide", "Vivid Slide", "Punchy slide-film colour: rich saturation, deep contrast, slightly cool shadows.", {
    curves: { red: s(0.05, 0.07), green: s(0.05, 0.07), blue: [[0, 0.02], [0.25, 0.21], [0.75, 0.81], [1, 1]] },
    saturation: 22,
    splitToning: { shadowHue: 220, shadowSaturation: 10 },
  }),
  builtIn("golden-hour", "Golden Hour", "Warm, glowing light with honeyed highlights.", {
    curves: { red: [[0, 0.02], [0.5, 0.55], [1, 1]], green: [[0, 0], [0.5, 0.51], [1, 0.98]], blue: [[0, 0], [0.5, 0.43], [1, 0.88]] },
    saturation: 6,
    splitToning: { highlightHue: 40, highlightSaturation: 22, balance: 15 },
  }),
  builtIn("faded-print", "Faded Print", "An old colour print: lifted blacks, muted colour, warm highlights, some grain.", {
    curves: {
      red: [[0, 0.06], [0.5, 0.52], [1, 0.95]],
      green: [[0, 0.05], [0.5, 0.5], [1, 0.94]],
      blue: [[0, 0.09], [0.5, 0.48], [1, 0.9]],
    },
    saturation: -22,
    fade: 12,
    splitToning: { highlightHue: 45, highlightSaturation: 12 },
    grain: { amount: 18, size: 35 },
  }),
  builtIn("matte", "Matte", "Flat, low-contrast matte finish with soft blacks.", {
    curves: all([[0, 0.08], [0.5, 0.5], [1, 0.94]]),
    saturation: -10,
    fade: 8,
  }),
  builtIn("cool-cinema", "Cool Cinema", "Teal shadows and warm highlights, as in modern film grading.", {
    curves: all(s(0.03, 0.04)),
    saturation: -6,
    splitToning: { shadowHue: 190, shadowSaturation: 32, highlightHue: 32, highlightSaturation: 26, balance: 10 },
  }),
  builtIn("soft-pastel", "Soft Pastel", "Airy and light: gentle fade, soft colour, faint pink highlights.", {
    curves: all([[0, 0.05], [0.5, 0.55], [1, 0.98]]),
    saturation: -18,
    fade: 6,
    splitToning: { shadowHue: 205, shadowSaturation: 8, highlightHue: 340, highlightSaturation: 9 },
  }),
  builtIn("cross-process", "Cross Process", "Cross-processed film: contrasty reds, green-yellow mids, washed-out blue blacks.", {
    curves: {
      red: [[0, 0], [0.25, 0.18], [0.75, 0.86], [1, 1]],
      green: [[0, 0.02], [0.5, 0.56], [1, 1]],
      blue: [[0, 0.14], [0.5, 0.45], [1, 0.82]],
    },
    saturation: 10,
  }),
  builtIn("classic-bw", "Classic B&W", "Neutral black and white with a gentle S-curve and fine grain.", {
    monochrome: NEUTRAL_MIX,
    curves: all(s(0.03, 0.04)),
    grain: { amount: 15, size: 25 },
  }),
  builtIn("high-contrast-bw", "High Contrast B&W", "Bold, graphic black and white with dark skies (red filter) and coarse grain.", {
    monochrome: { red: 70, green: 45, blue: -15 },
    curves: all(s(0.08, 0.1)),
    grain: { amount: 25, size: 45 },
  }),
  builtIn("soft-bw", "Soft B&W", "Gentle, low-contrast black and white with soft blacks.", {
    monochrome: NEUTRAL_MIX,
    curves: all([[0, 0.04], [0.5, 0.52], [1, 0.96]]),
    fade: 6,
    grain: { amount: 8, size: 20 },
  }),
  builtIn("selenium", "Selenium", "Black and white with cool, plum-toned shadows, as from a selenium toner.", {
    monochrome: NEUTRAL_MIX,
    curves: all(s(0.04, 0.03)),
    splitToning: { shadowHue: 285, shadowSaturation: 16, highlightHue: 45, highlightSaturation: 4, balance: -10 },
  }),
  builtIn("sepia", "Sepia", "Warm brown-toned black and white, like an antique print.", {
    monochrome: NEUTRAL_MIX,
    curves: all([[0, 0.03], [0.5, 0.52], [1, 0.96]]),
    fade: 5,
    splitToning: { shadowHue: 28, shadowSaturation: 36, highlightHue: 40, highlightSaturation: 28 },
    grain: { amount: 12, size: 30 },
  }),
];

const BUILTIN_BY_ID = new Map(BUILTIN_PROFILES.map((p) => [p.id, p]));

/** A profile by id: built-in, or one of the user's. */
export function findProfile(id: string, user: readonly Profile[]): Profile | undefined {
  return BUILTIN_BY_ID.get(id) ?? user.find((p) => p.id === id);
}
