import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import styles from "./Modal.module.css";

interface ModalProps {
  label: string;
  onEscape: () => void;
  onBackdropClick?: () => void;
  className?: string;
  /** "top": a centred dialog near the top (default). "bottom": a sheet that slides up from the bottom edge, for small screens. */
  placement?: "top" | "bottom";
  children: ReactNode;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Accessible dialog shell: traps focus, handles Escape, restores focus on close. */
export function Modal({ label, onEscape, onBackdropClick, className, placement = "top", children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  // If focus fell out of the dialog (e.g. the focused element unmounted), Escape still closes it
  // and focus returns to the dialog.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (!ref.current || ref.current.contains(document.activeElement)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onEscapeRef.current();
      } else {
        ref.current.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (ref.current && !ref.current.contains(document.activeElement)) {
      (ref.current.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current).focus();
    }
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    }
    if (e.key === "Tab" && ref.current) {
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0]!;
      const last = items.at(-1)!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  const sheet = placement === "bottom";
  return (
    <div className={`${styles.scrim} ${sheet ? styles.sheetScrim : ""}`} onMouseDown={(e) => e.target === e.currentTarget && onBackdropClick?.()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`${styles.dialog} ${sheet ? styles.sheet : ""} ${className ?? ""}`}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
