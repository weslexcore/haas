import { defineAction } from "../core/actions/types";
import { signedIn } from "../core/actions/when";

export const signOut = defineAction({
  id: "app.account.signOut",
  title: "Sign Out",
  description:
    "Sign out of the Photon account. Pending rating, flag and label changes are saved first; the app then returns to the " +
    "sign-in screen. Photos and edits stay on this device.",
  category: "App",
  kind: "command",
  sideEffects: true,
  when: signedIn,
  async run(_, ctx) {
    await ctx.services.persistence.flush();
    await ctx.services.auth.signOut();
  },
});

export const addPasskey = defineAction({
  id: "app.account.passkey.add",
  title: "Add a Passkey",
  description:
    "Register a passkey (Face ID, Touch ID, Windows Hello, a password manager or a security key) for the signed-in " +
    "account, so the user can sign in on this device without an email link or text code.",
  category: "App",
  kind: "command",
  sideEffects: true,
  when: signedIn,
  async run(_, ctx) {
    return ctx.services.auth.addPasskey();
  },
});

export const accountActions = [signOut, addPasskey];
