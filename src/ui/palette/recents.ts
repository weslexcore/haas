import type { SettingsStore } from "../../core/services";

const KEY = "palette.recent";
const MAX = 8;

let recents: string[] = [];

/** Palette row keys, most recent first. Loaded once at startup so the palette opens instantly. */
export async function loadRecents(settings: SettingsStore): Promise<void> {
  const stored = await settings.get<unknown>(KEY);
  recents = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === "string") : [];
}

export function getRecents(): readonly string[] {
  return recents;
}

export function pushRecent(settings: SettingsStore, rowKey: string): void {
  recents = [rowKey, ...recents.filter((k) => k !== rowKey)].slice(0, MAX);
  void settings.set(KEY, recents);
}
