import { useEffect, useRef, useState } from "react";
import { useAppState } from "../hooks";
import { ActionButton } from "./ActionButton";
import styles from "./AccountMenu.module.css";

/** The signed-in account, with Add a Passkey and Sign Out. Hidden when sign-in is off. */
export function AccountMenu() {
  const account = useAppState((s) => s.account);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
    };
  }, [open]);

  if (!account) return null;
  const name = account.email ?? account.phone ?? "Account";

  return (
    <div className={styles.root} ref={root}>
      <button
        type="button"
        className={styles.avatar}
        aria-label={`Account: ${name}`}
        title={name}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {(account.email?.[0] ?? "#").toUpperCase()}
      </button>
      {open && (
        <div className={styles.menu} role="menu" aria-label="Account" onClick={() => setOpen(false)}>
          <div className={styles.identity}>
            <span className={styles.caption}>Signed in as</span>
            <span className={styles.name}>{name}</span>
          </div>
          <ActionButton actionId="app.account.passkey.add" role="menuitem" className={styles.item}>
            Add a Passkey…
          </ActionButton>
          <ActionButton actionId="app.account.signOut" role="menuitem" className={styles.item}>
            Sign Out
          </ActionButton>
        </div>
      )}
    </div>
  );
}
