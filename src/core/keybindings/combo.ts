/**
 * Key combo parsing, normalisation and display.
 *
 * Canonical stroke format: lower-case modifiers in the order
 * mod, ctrl, alt, shift, meta, then the key — e.g. "mod+shift+z".
 * `mod` is Cmd on macOS and Ctrl elsewhere. A chord is strokes joined by a
 * single space: "t t".
 *
 * Symbol keys are written as the character they produce, so "?" rather than
 * "shift+/" (the shift is implied and keyboard layouts differ).
 */

export class KeyComboError extends Error {}

const MODIFIERS = ["mod", "ctrl", "alt", "shift", "meta"] as const;
type Modifier = (typeof MODIFIERS)[number];

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  " ": "space",
  spacebar: "space",
  del: "delete",
  "+": "plus",
};

const MODIFIER_KEYS = new Set(["shift", "control", "alt", "meta", "os", "capslock", "fn", "altgraph", "dead", "unidentified", "process"]);

function modifierToken(token: string, isMac: boolean): Modifier | null {
  switch (token) {
    case "mod":
      return "mod";
    case "cmd":
    case "command":
    case "meta":
    case "super":
    case "win":
      return isMac ? "mod" : "meta";
    case "ctrl":
    case "control":
      return isMac ? "ctrl" : "mod";
    case "alt":
    case "opt":
    case "option":
      return "alt";
    case "shift":
      return "shift";
    default:
      return null;
  }
}

export function normalizeKeyName(key: string): string {
  if (key === " ") return "space";
  const lower = key.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

/** A single printable character other than a letter: its shift state is implied by the character. */
function isSymbolKey(key: string): boolean {
  return [...key].length === 1 && !/^[a-z]$/.test(key);
}

export function normalizeStroke(stroke: string, isMac: boolean): string {
  const raw = stroke.trim();
  if (!raw) throw new KeyComboError("Empty key stroke.");
  // "mod++" style: a trailing "+" is the plus key.
  const tokens = raw.endsWith("++") ? [...raw.slice(0, -2).split("+"), "+"] : raw === "+" ? ["+"] : raw.split("+");
  const mods = new Set<Modifier>();
  let key: string | null = null;
  for (const token of tokens) {
    if (token === "") throw new KeyComboError(`Malformed key stroke "${stroke}".`);
    const mod = modifierToken(token.toLowerCase(), isMac);
    if (mod) {
      mods.add(mod);
      continue;
    }
    if (key !== null) throw new KeyComboError(`Key stroke "${stroke}" has more than one non-modifier key.`);
    key = normalizeKeyName(token);
  }
  if (key === null) throw new KeyComboError(`Key stroke "${stroke}" has no key, only modifiers.`);
  if (mods.has("shift") && isSymbolKey(key)) {
    throw new KeyComboError(
      `Write symbol keys as the character they produce (e.g. "?" instead of "shift+/"), not "${stroke}".`,
    );
  }
  return [...MODIFIERS.filter((m) => mods.has(m)), key].join("+");
}

export function normalizeChord(keys: string, isMac: boolean): string {
  const strokes = keys.trim().split(/\s+/);
  if (strokes.length === 0 || strokes[0] === "") throw new KeyComboError("Empty key combo.");
  return strokes.map((s) => normalizeStroke(s, isMac)).join(" ");
}

export function tryNormalizeChord(keys: string, isMac: boolean): string | null {
  try {
    return normalizeChord(keys, isMac);
  } catch {
    return null;
  }
}

export interface KeyEventLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Canonical stroke for a keyboard event, or null for a bare modifier press. */
export function strokeFromEvent(e: KeyEventLike, isMac: boolean): string | null {
  if (!e.key || MODIFIER_KEYS.has(e.key.toLowerCase())) return null;
  let key = e.key;
  // Option/Alt changes the produced character on macOS (⌥E is a dead key); use the physical key instead.
  const code = e.code ?? "";
  if (e.altKey && /^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (e.altKey && /^Digit\d$/.test(code)) key = code.slice(5);
  key = normalizeKeyName(key);

  const mods: Modifier[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) mods.push("mod");
  if (isMac && e.ctrlKey) mods.push("ctrl");
  if (e.altKey) mods.push("alt");
  if (e.shiftKey && !isSymbolKey(key)) mods.push("shift");
  if (!isMac && e.metaKey) mods.push("meta");
  return [...mods, key].join("+");
}

const MAC_MOD_SYMBOLS: Record<Modifier, string> = { ctrl: "⌃", alt: "⌥", shift: "⇧", mod: "⌘", meta: "⌘" };
const PC_MOD_NAMES: Record<Modifier, string> = { mod: "Ctrl", ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "Win" };
const MAC_DISPLAY_ORDER: Modifier[] = ["ctrl", "alt", "shift", "mod", "meta"];
const PC_DISPLAY_ORDER: Modifier[] = ["mod", "ctrl", "alt", "shift", "meta"];

const KEY_DISPLAY: Record<string, { mac: string; pc: string }> = {
  up: { mac: "↑", pc: "↑" },
  down: { mac: "↓", pc: "↓" },
  left: { mac: "←", pc: "←" },
  right: { mac: "→", pc: "→" },
  enter: { mac: "↩", pc: "Enter" },
  escape: { mac: "Esc", pc: "Esc" },
  space: { mac: "Space", pc: "Space" },
  backspace: { mac: "⌫", pc: "Backspace" },
  delete: { mac: "⌦", pc: "Del" },
  tab: { mac: "⇥", pc: "Tab" },
  plus: { mac: "+", pc: "+" },
  pageup: { mac: "PgUp", pc: "PgUp" },
  pagedown: { mac: "PgDn", pc: "PgDn" },
  home: { mac: "Home", pc: "Home" },
  end: { mac: "End", pc: "End" },
};

/** Display form of each stroke in a canonical chord, e.g. ["⌘⇧Z"] or ["Ctrl+Shift+Z"]. */
export function formatChordStrokes(chord: string, isMac: boolean): string[] {
  return chord.split(" ").map((stroke) => {
    const parts = stroke.split("+");
    const key = parts.pop() ?? "";
    const mods = new Set(parts.filter((p): p is Modifier => (MODIFIERS as readonly string[]).includes(p)));
    const keyLabel = KEY_DISPLAY[key]?.[isMac ? "mac" : "pc"] ?? (key.length === 1 ? key.toUpperCase() : capitalize(key));
    if (isMac) {
      return MAC_DISPLAY_ORDER.filter((m) => mods.has(m)).map((m) => MAC_MOD_SYMBOLS[m]).join("") + keyLabel;
    }
    return [...PC_DISPLAY_ORDER.filter((m) => mods.has(m)).map((m) => PC_MOD_NAMES[m]), keyLabel].join("+");
  });
}

export function formatChord(chord: string, isMac: boolean): string {
  return formatChordStrokes(chord, isMac).join(" ");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}
