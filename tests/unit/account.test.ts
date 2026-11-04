import { describe, expect, it } from "vitest";
import { accountOf, normalizePhone, readAuthMode } from "../../src/adapters/auth/supabase-auth";
import { reviewStep } from "../../src/core/ai/plan";
import { createTestRuntime } from "./helpers";

const account = { id: "u1", email: "ada@example.com", phone: null };

describe("account actions", () => {
  it("are unavailable when sign-in is off", async () => {
    const rt = await createTestRuntime();
    const r = await rt.dispatch("app.account.signOut");
    expect(r).toMatchObject({ ok: false, error: "unavailable" });
    expect(rt.auth.signedOut).toBe(0);
  });

  it("sign out after saving pending changes", async () => {
    const rt = await createTestRuntime({ account });
    let flushed = false;
    rt.services.persistence.flush = async () => void (flushed = true);
    expect((await rt.dispatch("app.account.signOut")).ok).toBe(true);
    expect(flushed).toBe(true);
    expect(rt.auth.signedOut).toBe(1);
  });

  it("add a passkey", async () => {
    const rt = await createTestRuntime({ account });
    expect(await rt.dispatch("app.account.passkey.add")).toMatchObject({ ok: true, value: { name: "Test Passkey" } });
    expect(rt.auth.passkeys).toBe(1);
  });

  it("can't be used in AI plans", async () => {
    const rt = await createTestRuntime({ account });
    const step = reviewStep(rt.registry, rt.dispatcher.readonlyContext(), { actionId: "app.account.signOut", params: undefined, reason: "" });
    expect(step.valid).toBe(false);
  });
});

describe("auth settings", () => {
  it("is on only with both a URL and a publishable key", () => {
    expect(readAuthMode({})).toEqual({ kind: "off", reason: "unconfigured" });
    expect(readAuthMode({ VITE_SUPABASE_URL: "https://x.supabase.co" })).toEqual({ kind: "off", reason: "unconfigured" });
    expect(readAuthMode({ VITE_SUPABASE_URL: "https://x.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_k" })).toEqual({
      kind: "on",
      url: "https://x.supabase.co",
      publishableKey: "sb_publishable_k",
    });
  });

  it("can be turned off for end-to-end tests", () => {
    expect(readAuthMode({ VITE_AUTH: "off", VITE_SUPABASE_URL: "u", VITE_SUPABASE_PUBLISHABLE_KEY: "k" })).toEqual({ kind: "off", reason: "disabled" });
  });
});

describe("phone numbers", () => {
  it("accepts international numbers with separators", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone(" +44 20 7946 0958 ")).toBe("+442079460958");
  });

  it("needs a country code", () => {
    expect(normalizePhone("555 123 4567")).toBeNull();
    expect(normalizePhone("+0 555")).toBeNull();
    expect(normalizePhone("+1 abc")).toBeNull();
  });

  it("are shown with a plus, which Supabase leaves off", () => {
    const session = { user: { id: "u2", email: "", phone: "15551234567" } } as Parameters<typeof accountOf>[0];
    expect(accountOf(session)).toEqual({ id: "u2", email: null, phone: "+15551234567" });
  });
});
