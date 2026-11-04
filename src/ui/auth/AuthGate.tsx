import { useEffect, useRef, useState } from "react";
import { accountOf, passkeysSupported, SupabaseAuth, type AuthMode } from "../../adapters/auth/supabase-auth";
import { THEME_SETTINGS_KEY } from "../../actions/app";
import { LocalSettingsStore } from "../../adapters/settings";
import type { Runtime } from "../../core/runtime";
import type { AuthService } from "../../core/services";
import type { Account } from "../../core/state/types";
import { App } from "../App";
import { createBrowserRuntime } from "../bootstrap";
import { RuntimeProvider } from "../runtime-context";
import { AuthLayout, PasskeyOffer, SignInScreen, type SignInMethod } from "./SignInScreen";
import styles from "./SignIn.module.css";

type Phase =
  | { kind: "checking" }
  | { kind: "signedOut"; error: string | null }
  | { kind: "offerPasskey"; account: Account }
  | { kind: "starting" }
  | { kind: "app"; runtime: Runtime }
  | { kind: "unconfigured" }
  | { kind: "failed"; message: string };

/** Used when sign-in is off: there is no account to sign out of. */
const noAuth: AuthService = {
  signOut: async () => undefined,
  addPasskey: async () => {
    throw new Error("Sign-in is turned off.");
  },
};

const passkeyOfferKey = (userId: string) => `photon:passkeyOffer:dismissed:${userId}`;

/**
 * Nothing loads (folder, previews, AI) until someone is signed in. After an
 * email or phone sign-in, a passkey is offered once. Signing out (here or in
 * another tab) reloads the page, which tears the runtime down cleanly.
 */
export function AuthGate({ mode }: { mode: AuthMode }) {
  const [auth] = useState(() => (mode.kind === "on" ? new SupabaseAuth(mode) : null));
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  /** How the pending sign-in was started; a session that arrives otherwise came from an email link. */
  const method = useRef<SignInMethod | null>(null);
  const decided = useRef(false);

  useEffect(applySavedTheme, []);

  useEffect(() => {
    const enter = (account: Account | null) => launch(auth ?? noAuth, account, setPhase);

    if (!auth) {
      if (mode.kind === "off" && mode.reason === "unconfigured" && import.meta.env.PROD) {
        setPhase({ kind: "unconfigured" });
      } else {
        if (mode.kind === "off" && mode.reason === "unconfigured") {
          console.warn("Photon: sign-in is off because VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY aren't set. See .env.example.");
        }
        enter(null);
      }
      return;
    }

    /** Runs once per page, for whichever arrives first: the saved session, a magic link, or a sign-in. */
    const signedIn = async (account: Account, offer: boolean) => {
      if (decided.current) return;
      decided.current = true;
      if (offer && passkeysSupported() && !localStorage.getItem(passkeyOfferKey(account.id)) && !(await auth.hasPasskey())) {
        setPhase({ kind: "offerPasskey", account });
      } else {
        enter(account);
      }
    };

    let active = true;
    void auth.init().then(({ session, fromLink, error }) => {
      if (!active) return;
      if (session) void signedIn(accountOf(session), fromLink);
      else setPhase((p) => (p.kind === "checking" ? { kind: "signedOut", error } : p));
    });
    const unsubscribe = auth.onChange((session) => {
      if (!session) {
        if (decided.current) window.location.reload();
        return;
      }
      // Passkey sign-ins skip the offer; email links (possibly opened in another tab) and phone codes get it.
      void signedIn(accountOf(session), method.current !== "passkey");
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [auth, mode]);

  switch (phase.kind) {
    case "checking":
    case "starting":
      return <AuthLayout busy />;
    case "signedOut":
      return <SignInScreen auth={auth!} initialError={phase.error} onAttempt={(m) => (method.current = m)} />;
    case "offerPasskey":
      return (
        <PasskeyOffer
          auth={auth!}
          onDone={(dismissed) => {
            if (dismissed) localStorage.setItem(passkeyOfferKey(phase.account.id), "1");
            launch(auth!, phase.account, setPhase);
          }}
        />
      );
    case "app":
      return (
        <RuntimeProvider runtime={phase.runtime}>
          <App />
        </RuntimeProvider>
      );
    case "unconfigured":
      return (
        <AuthLayout>
          <h1 className={styles.title}>Sign-in isn't set up</h1>
          <p className={`${styles.lede} ${styles.setup}`}>
            This build of Photon has no Supabase project. Set <code>VITE_SUPABASE_URL</code> and{" "}
            <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> and build again.
          </p>
        </AuthLayout>
      );
    case "failed":
      return (
        <AuthLayout>
          <h1 className={styles.title}>Photon couldn't start</h1>
          <p className={styles.error} role="alert">{phase.message}</p>
          <button type="button" className={styles.secondary} onClick={() => window.location.reload()}>
            Reload
          </button>
        </AuthLayout>
      );
  }
}

/** One runtime per page, even though React StrictMode runs effects twice in development. */
let runtimePromise: Promise<Runtime> | null = null;
function launch(auth: AuthService, account: Account | null, setPhase: (phase: Phase) => void) {
  setPhase({ kind: "starting" });
  (runtimePromise ??= createBrowserRuntime({ auth, account })).then(
    (runtime) => setPhase({ kind: "app", runtime }),
    (e) => setPhase({ kind: "failed", message: e instanceof Error ? e.message : String(e) }),
  );
}

/** The app sets data-theme once it starts; do the same for the sign-in screen so it doesn't flash. */
function applySavedTheme() {
  void new LocalSettingsStore().get<string>(THEME_SETTINGS_KEY).then((theme) => {
    if (document.documentElement.dataset.theme) return;
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = theme === "light" || theme === "dark" ? theme : dark ? "dark" : "light";
  });
}
