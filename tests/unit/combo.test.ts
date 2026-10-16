import { describe, expect, it } from "vitest";
import { formatChord, normalizeChord, strokeFromEvent } from "../../src/core/keybindings/combo";
import { key } from "./helpers";

describe("normalizeChord", () => {
  it("orders modifiers canonically", () => {
    expect(normalizeChord("shift+mod+Z", false)).toBe("mod+shift+z");
    expect(normalizeChord("alt+ctrl+k", true)).toBe("ctrl+alt+k");
  });

  it("maps platform-specific names onto mod", () => {
    expect(normalizeChord("cmd+k", true)).toBe("mod+k");
    expect(normalizeChord("ctrl+k", false)).toBe("mod+k");
    expect(normalizeChord("ctrl+k", true)).toBe("ctrl+k");
    expect(normalizeChord("cmd+k", false)).toBe("meta+k");
  });

  it("handles chords, aliases and the plus key", () => {
    expect(normalizeChord("g   g", false)).toBe("g g");
    expect(normalizeChord("ArrowRight", false)).toBe("right");
    expect(normalizeChord("mod++", false)).toBe("mod+plus");
    expect(normalizeChord("\\", false)).toBe("\\");
  });

  it("rejects malformed combos", () => {
    expect(() => normalizeChord("", false)).toThrow();
    expect(() => normalizeChord("mod+shift", false)).toThrow(/no key/);
    expect(() => normalizeChord("a+b", false)).toThrow(/more than one/);
    expect(() => normalizeChord("shift+/", false)).toThrow(/character they produce/);
  });
});

describe("strokeFromEvent", () => {
  it("uses Cmd as mod on Mac and Ctrl elsewhere", () => {
    expect(strokeFromEvent(key("k", { meta: true }), true)).toBe("mod+k");
    expect(strokeFromEvent(key("k", { ctrl: true }), false)).toBe("mod+k");
    expect(strokeFromEvent(key("k", { ctrl: true }), true)).toBe("ctrl+k");
  });

  it("lower-cases shifted letters but keeps shift", () => {
    expect(strokeFromEvent(key("Z", { meta: true, shift: true }), true)).toBe("mod+shift+z");
  });

  it("drops shift for symbol characters", () => {
    expect(strokeFromEvent(key("?", { shift: true }), false)).toBe("?");
  });

  it("uses the physical key when Option changes the character", () => {
    expect(strokeFromEvent({ ...key("´", { alt: true }), code: "KeyE" }, true)).toBe("alt+e");
  });

  it("ignores bare modifiers", () => {
    expect(strokeFromEvent(key("Shift", { shift: true }), false)).toBeNull();
  });
});

describe("formatChord", () => {
  it("uses symbols on Mac", () => {
    expect(formatChord("mod+shift+z", true)).toBe("⇧⌘Z");
    expect(formatChord("mod+k", true)).toBe("⌘K");
    expect(formatChord("right", true)).toBe("→");
  });

  it("uses names elsewhere", () => {
    expect(formatChord("mod+shift+z", false)).toBe("Ctrl+Shift+Z");
    expect(formatChord("t t", false)).toBe("T T");
  });
});
