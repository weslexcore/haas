import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { MenuItem } from "../../core/menus/registry";
import { useAppState, useBindingsVersion } from "../hooks";
import { useRuntime } from "../runtime-context";
import { Kbd } from "../shell/Kbd";
import { toast } from "../toasts";
import styles from "./ContextMenu.module.css";

type ActionItem = Extract<MenuItem, { kind: "action" }>;

interface Anchor {
  x: number;
  y: number;
  /** For submenus: the parent item's rect, so the menu can flip to the left side. */
  flipX?: number;
}

/** Renders the open context menu (AppState.contextMenu). Menu content is data from the menu registry. */
export function ContextMenu() {
  const menuState = useAppState((s) => s.contextMenu);
  const runtime = useRuntime();
  const menu = menuState ? runtime.menus.get(menuState.menuId) : undefined;
  if (!menuState || !menu) return null;
  return <MenuRoot key={`${menu.id}:${menuState.x}:${menuState.y}`} items={menu.items} label={menu.title} x={menuState.x} y={menuState.y} />;
}

function MenuRoot({ items, label, x, y }: { items: MenuItem[]; label: string; x: number | null; y: number | null }) {
  const runtime = useRuntime();
  const rootRef = useRef<HTMLDivElement>(null);

  const anchor: Anchor = (() => {
    if (x !== null && y !== null) return { x, y };
    // Opened from the keyboard: place it by the active photo.
    const activeId = runtime.store.getState().selection.activeId;
    const el = activeId ? document.querySelector(`[data-photo-id="${CSS.escape(activeId)}"]`) : null;
    const rect = el?.getBoundingClientRect();
    return rect ? { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + Math.min(24, rect.height / 2) } : { x: innerWidth / 2, y: innerHeight / 3 };
  })();

  const close = () => void runtime.dispatch("app.contextMenu.close", undefined, { source: "menu" });

  const activate = async (item: ActionItem) => {
    await runtime.dispatch("app.contextMenu.close", undefined, { source: "menu" });
    const result = await runtime.dispatch(item.actionId, item.params, { source: "menu" });
    if (!result.ok) toast(result.message, "error");
  };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onPointer = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onDismiss = () => close();
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("wheel", onPointer, { capture: true, passive: true });
    window.addEventListener("resize", onDismiss);
    window.addEventListener("blur", onDismiss);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("wheel", onPointer, true);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("blur", onDismiss);
      if (previous?.isConnected) previous.focus();
    };
    // Mount/unmount only.
  }, []);

  return (
    <div ref={rootRef}>
      <MenuList items={items} label={label} anchor={anchor} level={0} onActivate={activate} onCloseAll={close} onCloseLevel={close} />
    </div>
  );
}

interface MenuListProps {
  items: MenuItem[];
  label: string;
  anchor: Anchor;
  level: number;
  onActivate: (item: ActionItem) => void;
  onCloseAll: () => void;
  onCloseLevel: () => void;
  /** Focus the first item on mount (keyboard-opened submenus and all root menus). */
  autoFocus?: boolean;
}

function MenuList({ items, label, anchor, level, onActivate, onCloseAll, onCloseLevel, autoFocus = true }: MenuListProps) {
  const { registry, keybindings, dispatcher } = useRuntime();
  useAppState((s) => s); // re-render when availability may change
  useBindingsVersion();
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });
  const [focus, setFocus] = useState(-1);
  const [openSub, setOpenSub] = useState<{ index: number; anchor: Anchor; viaKeyboard: boolean } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const enabled = (item: MenuItem): boolean =>
    item.kind === "action"
      ? dispatcher.isAvailable(item.actionId)
      : item.kind === "submenu"
        ? item.items.some(enabled)
        : false;
  const focusable = items.map((i) => i.kind !== "separator" && enabled(i));

  // Keep the menu on screen; submenus flip to the left of their parent when needed.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = anchor.x;
    if (left + width > innerWidth - 4) left = anchor.flipX !== undefined ? anchor.flipX - width : innerWidth - width - 4;
    const top = Math.min(anchor.y, innerHeight - height - 4);
    setPos({ left: Math.max(4, left), top: Math.max(4, top) });
  }, [anchor.x, anchor.y, anchor.flipX]);

  useEffect(() => {
    if (autoFocus) setFocus(focusable.indexOf(true));
    // Initial focus only.
  }, []);

  useEffect(() => {
    if (focus >= 0) itemRefs.current[focus]?.focus();
    else listRef.current?.focus();
  }, [focus]);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const move = (from: number, delta: number) => {
    for (let step = 1; step <= items.length; step++) {
      const i = (from + delta * step + items.length * 2) % items.length;
      if (focusable[i]) return i;
    }
    return from;
  };

  const openSubmenu = (index: number, viaKeyboard: boolean) => {
    const rect = itemRefs.current[index]?.getBoundingClientRect();
    if (!rect) return;
    setOpenSub({ index, anchor: { x: rect.right - 2, y: rect.top - 4, flipX: rect.left + 2 }, viaKeyboard });
  };

  const choose = (index: number, viaKeyboard: boolean) => {
    const item = items[index];
    if (!item || !focusable[index]) return;
    if (item.kind === "submenu") openSubmenu(index, viaKeyboard);
    else if (item.kind === "action") onActivate(item);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    // A submenu opened by hovering doesn't take focus; navigating the parent closes it.
    if (openSub && !["ArrowRight", "Enter", " "].includes(e.key)) setOpenSub(null);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setFocus((f) => move(f, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocus((f) => move(f < 0 ? 0 : f, -1));
        break;
      case "Home":
        e.preventDefault();
        setFocus(focusable.indexOf(true));
        break;
      case "End":
        e.preventDefault();
        setFocus(focusable.lastIndexOf(true));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(focus, true);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (items[focus]?.kind === "submenu") choose(focus, true);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (level > 0) onCloseLevel();
        break;
      case "Escape":
        e.preventDefault();
        if (level > 0) onCloseLevel();
        else onCloseAll();
        break;
      case "Tab":
        e.preventDefault();
        onCloseAll();
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          // Type-ahead: next enabled item whose label starts with the key.
          const k = e.key.toLowerCase();
          for (let step = 1; step <= items.length; step++) {
            const i = (focus + step) % items.length;
            if (focusable[i] && itemLabel(items[i]!).toLowerCase().startsWith(k)) {
              setFocus(i);
              break;
            }
          }
        }
    }
  };

  const itemLabel = (item: MenuItem): string => {
    if (item.kind === "separator") return "";
    if (item.kind === "submenu") return item.label;
    const action = registry.get(item.actionId);
    return item.label ?? action?.label?.(item.params) ?? action?.title ?? item.actionId;
  };

  const shortcutFor = (item: ActionItem): string[] | null => {
    const paramsKey = JSON.stringify(item.params);
    const b = keybindings.bindingsFor(item.actionId).find((x) => JSON.stringify(x.params) === paramsKey);
    return b ? keybindings.formatStrokes(b.keys) : null;
  };

  return (
    <>
      <div
        ref={listRef}
        role="menu"
        aria-label={label}
        aria-orientation="vertical"
        tabIndex={-1}
        className={styles.menu}
        style={{ left: pos.left, top: pos.top }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((item, i) => {
          if (item.kind === "separator") return <div key={i} role="separator" className={styles.separator} />;
          const disabled = !focusable[i];
          const isSub = item.kind === "submenu";
          const shortcut = item.kind === "action" ? shortcutFor(item) : null;
          const text = itemLabel(item);
          return (
            <button
              key={i}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              aria-label={text}
              aria-keyshortcuts={shortcut ? shortcut.join(" ") : undefined}
              tabIndex={focus === i ? 0 : -1}
              aria-disabled={disabled || undefined}
              aria-haspopup={isSub ? "menu" : undefined}
              aria-expanded={isSub ? openSub?.index === i : undefined}
              className={`${styles.item} ${focus === i ? styles.focused : ""}`}
              onMouseEnter={() => {
                setFocus(disabled ? -1 : i);
                clearTimeout(hoverTimer.current);
                if (isSub && !disabled) hoverTimer.current = setTimeout(() => openSubmenu(i, false), 120);
                else if (openSub) hoverTimer.current = setTimeout(() => setOpenSub(null), 120);
              }}
              onClick={() => choose(i, false)}
            >
              <span className={styles.label}>{text}</span>
              {shortcut && <Kbd strokes={shortcut} className={styles.shortcut} />}
              {isSub && <span className={styles.chevron} aria-hidden="true">›</span>}
            </button>
          );
        })}
      </div>
      {openSub && items[openSub.index]?.kind === "submenu" && (
        <MenuList
          key={openSub.index}
          items={(items[openSub.index] as Extract<MenuItem, { kind: "submenu" }>).items}
          label={itemLabel(items[openSub.index]!)}
          anchor={openSub.anchor}
          level={level + 1}
          autoFocus={openSub.viaKeyboard}
          onActivate={onActivate}
          onCloseAll={onCloseAll}
          onCloseLevel={() => {
            const index = openSub.index;
            setOpenSub(null);
            setFocus(index);
            itemRefs.current[index]?.focus();
          }}
        />
      )}
    </>
  );
}
