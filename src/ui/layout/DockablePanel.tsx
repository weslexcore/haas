import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { LAYOUT_LIMITS, type PanelSide } from "../../core/state/layout";
import { useAppState, useDispatch } from "../hooks";
import { Icon } from "../shell/Icon";
import { useDrag } from "./useDrag";
import styles from "./DockablePanel.module.css";

/** Dropping a floating panel this close to a window edge docks it there. */
const DOCK_EDGE = 32;
/** Dragging a docked panel's header this far tears it off. */
const TEAR_OFF = 8;
const HEADER_HEIGHT = 32;

interface DockablePanelProps {
  title: string;
  children: ReactNode;
  /**
   * Small screens: the panel stays where the view puts it (a sheet under the photo, or beside it
   * on a phone held sideways). It neither floats nor changes side; the remembered layout is left
   * alone for bigger windows. With onCollapse, the header has a button that hides it.
   */
  fixed?: boolean;
  onCollapse?: () => void;
}

/**
 * A panel that docks to the left or right of the window or floats over it.
 * Drag the header to tear it off and move it; drop it against a window edge
 * to dock it there. The header buttons do the same without dragging.
 */
export function DockablePanel({ title, children, fixed = false, onCollapse }: DockablePanelProps) {
  const layout = useAppState((s) => s.layout);
  const dispatch = useDispatch();
  const frameRef = useRef<HTMLDivElement>(null);
  const [dockHint, setDockHint] = useState<PanelSide | null>(null);
  const gesture = useRef({ floating: false, grabX: 0, grabY: 0, width: 0, height: 0 });

  const dockSideAt = (x: number): PanelSide | null => (x <= DOCK_EDGE ? "left" : x >= window.innerWidth - DOCK_EDGE ? "right" : null);

  const onHeaderPointerDown = useDrag({
    cursor: "grabbing",
    onStart: (s) => {
      const rect = frameRef.current?.getBoundingClientRect();
      const { width, height } = layout.panelDocked ? { width: layout.panelFloat.width, height: layout.panelFloat.height } : layout.panelFloat;
      gesture.current = {
        floating: !layout.panelDocked,
        // Keep the grab point inside the header once the panel takes its floating size.
        grabX: Math.min(s.x - (rect?.left ?? s.x), width - 96),
        grabY: Math.min(s.y - (rect?.top ?? s.y), HEADER_HEIGHT - 4),
        width,
        height,
      };
    },
    onMove: (s) => {
      const g = gesture.current;
      if (!g.floating) {
        if (Math.abs(s.dx) < TEAR_OFF && Math.abs(s.dy) < TEAR_OFF) return;
        g.floating = true;
        void dispatch("view.panel.undock", { x: s.x - g.grabX, y: s.y - g.grabY });
      } else {
        void dispatch("view.panel.float.set", { x: s.x - g.grabX, y: s.y - g.grabY });
      }
      setDockHint(dockSideAt(s.x));
    },
    onEnd: (s) => {
      const side = gesture.current.floating ? dockSideAt(s.x) : null;
      setDockHint(null);
      if (side) void dispatch("view.panel.dock", { side });
    },
  });

  const onCornerPointerDown = useDrag({
    cursor: "nwse-resize",
    onStart: () => {
      gesture.current.width = layout.panelFloat.width;
      gesture.current.height = layout.panelFloat.height;
    },
    onMove: (s) => void dispatch("view.panel.float.set", { width: gesture.current.width + s.dx, height: gesture.current.height + s.dy }),
  });

  if (fixed) {
    return (
      <div ref={frameRef} className={`${styles.frame} ${styles.docked}`} data-panel-state="fixed">
        <div className={`${styles.header} ${styles.staticHeader}`}>
          <span className={styles.title}>{title}</span>
          {onCollapse && <HeaderButton label="Hide panel" icon="chevronDown" onClick={onCollapse} />}
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    );
  }

  const { panelDocked: docked, panelSide: side, panelFloat: rect } = layout;
  const floatStyle: CSSProperties | undefined = docked
    ? undefined
    : {
        left: `clamp(0px, ${rect.x}px, calc(100vw - ${rect.width}px))`,
        top: `clamp(0px, ${rect.y}px, calc(100vh - ${HEADER_HEIGHT + 8}px))`,
        width: rect.width,
        height: rect.height,
      };

  return (
    <>
      <div
        ref={frameRef}
        className={`${styles.frame} ${docked ? `${styles.docked} ${side === "left" ? styles.left : styles.right}` : styles.floating}`}
        style={floatStyle}
        data-panel-state={docked ? `docked-${side}` : "floating"}
        role={docked ? undefined : "dialog"}
        aria-label={docked ? undefined : `${title} panel (floating)`}
      >
        <div
          className={styles.header}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            onHeaderPointerDown(e);
          }}
          title="Drag to move the panel"
        >
          <span className={styles.grip} aria-hidden="true">
            <Icon name="grip" size={14} />
          </span>
          <span className={styles.title}>{title}</span>
          {docked ? (
            <>
              <HeaderButton
                label={side === "left" ? "Move panel to the right" : "Move panel to the left"}
                icon={side === "left" ? "panelRight" : "panelLeft"}
                onClick={() => void dispatch("view.panel.side.toggle")}
              />
              <HeaderButton label="Undock panel" icon="float" onClick={() => void dispatch("view.panel.undock")} />
            </>
          ) : (
            <>
              <HeaderButton label="Dock panel on the left" icon="panelLeft" onClick={() => void dispatch("view.panel.dock", { side: "left" })} />
              <HeaderButton label="Dock panel on the right" icon="panelRight" onClick={() => void dispatch("view.panel.dock", { side: "right" })} />
            </>
          )}
        </div>
        <div className={styles.body}>{children}</div>
        {!docked && (
          <div
            className={styles.corner}
            onPointerDown={onCornerPointerDown}
            title={`Drag to resize (${LAYOUT_LIMITS.floatWidth.min}px minimum)`}
            aria-hidden="true"
          />
        )}
      </div>
      {dockHint && <div className={`${styles.dockZone} ${dockHint === "left" ? styles.dockLeft : styles.dockRight}`} aria-hidden="true" />}
    </>
  );
}

function HeaderButton({ label, icon, onClick }: { label: string; icon: "panelLeft" | "panelRight" | "float" | "chevronDown"; onClick: () => void }) {
  return (
    <button type="button" className={styles.button} aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} size={14} />
    </button>
  );
}
