import type { ViewMode } from "../../core/state/types";
import { useAppState, useShortcut } from "../hooks";
import { ActionButton } from "./ActionButton";
import { Icon, type IconName } from "./Icon";
import { Kbd } from "./Kbd";
import styles from "./TopBar.module.css";

const VIEWS: Array<{ view: ViewMode; label: string; icon: IconName }> = [
  { view: "grid", label: "Grid", icon: "grid" },
  { view: "loupe", label: "Loupe", icon: "loupe" },
  { view: "develop", label: "Develop", icon: "develop" },
];

export function TopBar() {
  const current = useAppState((s) => s.view);
  const paletteShortcut = useShortcut("app.palette.open");

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <span className={styles.brand}>Photo</span>
        <ActionButton actionId="library.folder.open" className={styles.folderButton}>
          <Icon name="folder" />
          <span>Open Folder…</span>
        </ActionButton>
      </div>

      <nav className={styles.views} aria-label="Views">
        {VIEWS.map(({ view, label, icon }) => (
          <ActionButton
            key={view}
            actionId="view.set"
            params={{ view }}
            className={styles.viewButton}
            aria-pressed={current === view}
          >
            <Icon name={icon} />
            <span>{label}</span>
          </ActionButton>
        ))}
      </nav>

      <div className={styles.tools}>
        <ActionButton actionId="app.palette.open" label="Search actions" className={styles.search}>
          <Icon name="search" />
          <span className={styles.searchText}>Search actions…</span>
          {paletteShortcut && <Kbd strokes={paletteShortcut.strokes} />}
        </ActionButton>
        <ActionButton actionId="app.ai.panel.toggle" className={styles.icon} label="AI conversation">
          <Icon name="sparkle" />
        </ActionButton>
        <ActionButton actionId="history.undo" className={styles.icon}>
          <Icon name="undo" />
        </ActionButton>
        <ActionButton actionId="history.redo" className={styles.icon}>
          <Icon name="redo" />
        </ActionButton>
        <ActionButton actionId="app.theme.toggle" className={styles.icon}>
          <Icon name="theme" />
        </ActionButton>
        <ActionButton actionId="app.shortcuts.open" className={styles.icon}>
          <Icon name="keyboard" />
        </ActionButton>
      </div>
    </header>
  );
}
