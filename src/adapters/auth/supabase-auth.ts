import { createClient, type AuthError, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthService } from "../../core/services";
import type { Account } from "../../core/state/types";

/**
 * Passwordless sign-in through Supabase Auth: an emailed magic link, a code
 * texted to a phone, or a passkey. Sessions persist in localStorage and
 * refresh automatically.
 */

export type AuthMode =
  | { kind: "on"; url: string; publishableKey: string }
  /** "disabled": VITE_AUTH=off (end-to-end tests). "unconfigured": no Supabase URL or key. */
  | { kind: "off"; reason: "disabled" | "unconfigured" };

/** From Vite's `import.meta.env`. */
export function readAuthMode(env: Record<string, string | boolean | undefined>): AuthMode {
  if (env.VITE_AUTH === "off") return { kind: "off", reason: "disabled" };
  const url = env.VITE_SUPABASE_URL;
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (typeof url !== "string" || !url || typeof publishableKey !== "string" || !publishableKey) {
    return { kind: "off", reason: "unconfigured" };
  }
  return { kind: "on", url, publishableKey };
}

/** Query parameters Supabase adds to the magic-link redirect. Removed once read. */
const REDIRECT_PARAMS = ["code", "error", "error_code", "error_description", "sb_flow_id"];

export interface InitResult {
  session: Session | null;
  /** The session came from a magic link just now (rather than an earlier visit). */
  fromLink: boolean;
  /** The magic link failed (expired, already used, opened in another browser). */
  error: string | null;
}

export class SupabaseAuth implements AuthService {
  readonly client: SupabaseClient;

  constructor(mode: Extract<AuthMode, { kind: "on" }>) {
    this.client = createClient(mode.url, mode.publishableKey, {
      auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, storageKey: "photon:auth" },
    });
  }

  /** Restores the saved session, or completes a magic-link sign-in from the URL. */
  async init(): Promise<InitResult> {
    const url = new URL(window.location.href);
    const hadCode = url.searchParams.has("code");
    const linkError = url.searchParams.get("error_description");
    const { data, error } = await this.client.auth.getSession();
    if (REDIRECT_PARAMS.some((p) => url.searchParams.has(p))) {
      for (const p of REDIRECT_PARAMS) url.searchParams.delete(p);
      window.history.replaceState(window.history.state, "", url);
    }
    const failure = linkError ?? (hadCode && !data.session ? describeError(error) : null);
    return { session: data.session, fromLink: hadCode && !!data.session, error: failure };
  }

  /** Sign-in (in this tab or another one) and sign-out, including a session that can no longer be refreshed. */
  onChange(listener: (session: Session | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") listener(session);
    });
    return () => data.subscription.unsubscribe();
  }

  async sendEmailLink(email: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/`, shouldCreateUser: true },
    });
    if (error) throw new Error(describeError(error));
  }

  async sendPhoneCode(phone: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } });
    if (error) throw new Error(describeError(error));
  }

  async verifyPhoneCode(phone: string, token: string): Promise<Session> {
    const { data, error } = await this.client.auth.verifyOtp({ phone, token, type: "sms" });
    if (error || !data.session) throw new Error(describeError(error));
    return data.session;
  }

  async signInWithPasskey(): Promise<Session> {
    const { data, error } = await this.client.auth.signInWithPasskey();
    if (error || !data?.session) throw new Error(describeError(error));
    return data.session;
  }

  async hasPasskey(): Promise<boolean> {
    const { data, error } = await this.client.auth.passkey.list();
    return !error && (data?.length ?? 0) > 0;
  }

  async addPasskey(): Promise<{ name: string | null }> {
    const { data, error } = await this.client.auth.registerPasskey();
    if (error || !data) throw new Error(describeError(error));
    return { name: data.friendly_name ?? null };
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw new Error(describeError(error));
  }
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

export function accountOf(session: Session): Account {
  const { id, email, phone } = session.user;
  return { id, email: email || null, phone: phone ? `+${phone.replace(/^\+/, "")}` : null };
}

/** E.164 ("+15551234567") from what the user typed, or null if it can't be one. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("+")) return null;
  const digits = trimmed.slice(1).replace(/[\s().-]/g, "");
  return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
}

/** Plain-language messages for the errors people actually hit. */
export function describeError(error: AuthError | Error | null | undefined): string {
  if (!error) return "Something went wrong. Please try again.";
  const code = "code" in error ? (error as AuthError).code : undefined;
  const name = (error as { name?: string }).name;
  if (name === "NotAllowedError" || name === "AbortError" || /ceremony|not allowed|cancel/i.test(error.message)) {
    return "The passkey prompt was cancelled.";
  }
  switch (code) {
    case "over_email_send_rate_limit":
    case "over_sms_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many attempts. Wait a minute and try again.";
    case "otp_expired":
      return "That code or link has expired. Request a new one.";
    case "flow_state_not_found":
    case "bad_code_verifier":
      return "Open the sign-in link in the same browser you requested it from.";
    case "phone_provider_disabled":
    case "sms_send_failed":
      return "Text messages aren't set up yet. Sign in with email instead.";
    case "email_provider_disabled":
      return "Email sign-in isn't turned on for Photon.";
    case "passkey_disabled":
      return "Passkey sign-in isn't turned on for Photon yet.";
    case "webauthn_credential_not_found":
      return "That passkey isn't registered with Photon. Sign in with email or phone, then add a passkey.";
    case "webauthn_credential_exists":
      return "This device already has a passkey for your account.";
    case "webauthn_challenge_expired":
      return "The passkey prompt timed out. Try again.";
    case "validation_failed":
      return "Check the email address or phone number and try again.";
  }
  return error.message || "Something went wrong. Please try again.";
}
