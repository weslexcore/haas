import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { normalizePhone, passkeysSupported, type SupabaseAuth } from "../../adapters/auth/supabase-auth";
import { PhotonMark } from "../brand/PhotonMark";
import styles from "./SignIn.module.css";

export type SignInMethod = "passkey" | "phone";

/** Seconds before a link or code can be sent again (Supabase allows one a minute by default). */
const RESEND_COOLDOWN = 60;

type Step = { kind: "enter" } | { kind: "emailSent"; email: string } | { kind: "phoneCode"; phone: string };

/**
 * Passwordless sign-in: a passkey, an emailed magic link, or a code texted to
 * a phone. New accounts are created on first sign-in. `onAttempt` tells the
 * gate which method produced the session that follows.
 */
export function SignInScreen({ auth, initialError, onAttempt }: {
  auth: SupabaseAuth;
  initialError: string | null;
  onAttempt: (method: SignInMethod) => void;
}) {
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [step, setStep] = useState<Step>({ kind: "enter" });
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<null | "passkey" | "send" | "verify">(null);
  const [error, setError] = useState<string | null>(initialError);
  const cooldown = useCooldown();

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const signInWithPasskey = () =>
    run("passkey", async () => {
      onAttempt("passkey");
      await auth.signInWithPasskey();
    });

  const sendEmail = (e?: FormEvent) => {
    e?.preventDefault();
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return setError("Enter a valid email address.");
    void run("send", async () => {
      await auth.sendEmailLink(address);
      setStep({ kind: "emailSent", email: address });
      cooldown.start(RESEND_COOLDOWN);
    });
  };

  const sendCode = (e?: FormEvent) => {
    e?.preventDefault();
    const number = normalizePhone(phone);
    if (!number) return setError("Enter your number with its country code, for example +1 555 123 4567.");
    void run("send", async () => {
      await auth.sendPhoneCode(number);
      setStep({ kind: "phoneCode", phone: number });
      setCode("");
      cooldown.start(RESEND_COOLDOWN);
    });
  };

  const verify = (token: string) => {
    if (step.kind !== "phoneCode" || busy) return;
    void run("verify", async () => {
      onAttempt("phone");
      await auth.verifyPhoneCode(step.phone, token);
    });
  };

  const back = () => {
    setStep({ kind: "enter" });
    setError(null);
  };

  return (
    <AuthLayout>
      {step.kind === "enter" && (
        <>
          <h1 className={styles.title}>Sign in to Photon</h1>
          <p className={styles.lede}>No password needed. New here? Signing in creates your account.</p>

          {passkeysSupported() && (
            <>
              <button type="button" className={styles.primary} onClick={signInWithPasskey} disabled={busy !== null}>
                <KeyIcon />
                {busy === "passkey" ? "Waiting for your passkey…" : "Sign in with a passkey"}
              </button>
              <div className={styles.divider}>
                <span>or</span>
              </div>
            </>
          )}

          <div className={styles.tabs} role="tablist" aria-label="Sign-in method">
            {(["email", "phone"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={method === m}
                className={styles.tab}
                onClick={() => {
                  setMethod(m);
                  setError(null);
                }}
              >
                {m === "email" ? "Email" : "Phone"}
              </button>
            ))}
          </div>

          {method === "email" ? (
            <form className={styles.form} onSubmit={sendEmail} noValidate>
              <label className={styles.label} htmlFor="signin-email">Email</label>
              <input
                id="signin-email"
                className={styles.input}
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
              <button type="submit" className={styles.secondary} disabled={busy !== null}>
                {busy === "send" ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
          ) : (
            <form className={styles.form} onSubmit={sendCode} noValidate>
              <label className={styles.label} htmlFor="signin-phone">Mobile number</label>
              <input
                id="signin-phone"
                className={styles.input}
                type="tel"
                autoComplete="tel"
                placeholder="+1 555 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoFocus
              />
              <button type="submit" className={styles.secondary} disabled={busy !== null}>
                {busy === "send" ? "Sending…" : "Text me a code"}
              </button>
            </form>
          )}
        </>
      )}

      {step.kind === "emailSent" && (
        <>
          <h1 className={styles.title}>Check your email</h1>
          <p className={styles.lede}>
            We sent a sign-in link to <strong>{step.email}</strong>. Open it in this browser to continue. The link works
            once and expires after an hour.
          </p>
          <div className={styles.row}>
            <button type="button" className={styles.link} onClick={back}>Use a different email</button>
            <button type="button" className={styles.link} onClick={() => sendEmail()} disabled={cooldown.left > 0 || busy !== null}>
              {cooldown.left > 0 ? `Resend in ${cooldown.left}s` : "Resend link"}
            </button>
          </div>
        </>
      )}

      {step.kind === "phoneCode" && (
        <>
          <h1 className={styles.title}>Enter your code</h1>
          <p className={styles.lede}>
            We texted a 6-digit code to <strong>{step.phone}</strong>.
          </p>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              verify(code);
            }}
          >
            <label className={styles.label} htmlFor="signin-code">Code</label>
            <input
              id="signin-code"
              className={`${styles.input} ${styles.code}`}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(digits);
                if (digits.length === 6) verify(digits);
              }}
              autoFocus
            />
            <button type="submit" className={styles.secondary} disabled={code.length !== 6 || busy !== null}>
              {busy === "verify" ? "Checking…" : "Sign in"}
            </button>
          </form>
          <div className={styles.row}>
            <button type="button" className={styles.link} onClick={back}>Use a different number</button>
            <button type="button" className={styles.link} onClick={() => sendCode()} disabled={cooldown.left > 0 || busy !== null}>
              {cooldown.left > 0 ? `Resend in ${cooldown.left}s` : "Resend code"}
            </button>
          </div>
        </>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </AuthLayout>
  );
}

/** After an email or phone sign-in: offer a passkey so next time is one tap. */
export function PasskeyOffer({ auth, onDone }: { auth: SupabaseAuth; onDone: (dismissed: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.addPasskey();
      onDone(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <AuthLayout>
      <h1 className={styles.title}>Sign in faster next time</h1>
      <p className={styles.lede}>
        Add a passkey and sign in with Face ID, Touch ID, Windows Hello or your password manager. No links or codes to wait for.
      </p>
      <button type="button" className={styles.primary} onClick={add} disabled={busy}>
        <KeyIcon />
        {busy ? "Waiting for your device…" : "Add a passkey"}
      </button>
      <button type="button" className={styles.link} onClick={() => onDone(true)} disabled={busy}>
        Not now
      </button>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </AuthLayout>
  );
}

/** Branded full-screen frame for sign-in, loading and setup messages. */
export function AuthLayout({ children, busy }: { children?: ReactNode; busy?: boolean }) {
  return (
    <div className={styles.screen}>
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.brand}>
        <PhotonMark size={busy ? 56 : 40} className={busy ? styles.pulse : undefined} />
        {!busy && <span className={styles.name}>Photon</span>}
      </div>
      {children && <main className={styles.card}>{children}</main>}
      {!busy && <p className={styles.footer}>Your photos stay on your device. Your account only signs you in.</p>}
    </div>
  );
}

function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="15" r="4" />
      <path d="m10.85 12.15 7.65-7.65M15.5 7.5l2.5 2.5M18 5l2 2" />
    </svg>
  );
}

function useCooldown() {
  const [left, setLeft] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearInterval(timer.current), []);
  return {
    left,
    start(seconds: number) {
      window.clearInterval(timer.current);
      setLeft(seconds);
      timer.current = window.setInterval(() => {
        setLeft((s) => {
          if (s <= 1) window.clearInterval(timer.current);
          return Math.max(0, s - 1);
        });
      }, 1000);
    },
  };
}
