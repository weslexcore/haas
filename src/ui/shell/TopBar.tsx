import type { ViewMode } from "../../core/state/types";
import { useAppState, useShortcut } from "../hooks";
import { useMobileLayout } from "../hooks/media";
import { PhotonMark, PhotonWordmark } from "../brand/PhotonMark";
import { AccountMenu } from "./AccountMenu";
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
  const folder = useAppState((s) => s.library.folder);
  const paletteShortcut = useShortcut("app.palette.open");
  const mobile = useMobileLayout();

  // Small screens: the mark, the folder, search and a "⋯" menu with the rest. Views move to the bottom bar.
  if (mobile) {
    return (
      <header className={`${styles.bar} ${styles.compact}`}>
        <PhotonMark size={22} className={styles.brand} />
        <ActionButton
          actionId="library.folder.open"
          className={`${styles.folderButton} ${styles.compactFolder}`}
          label={folder ? `Open Folder… (currently “${folder.name}”)` : undefined}
        >
          <Icon name="folder" />
          <span className={styles.folderName}>{folder ? folder.name : "Open Folder…"}</span>
        </ActionButton>
        <ActionButton actionId="app.palette.open" label="Search actions" className={styles.icon}>
          <Icon name="search" size={18} />
        </ActionButton>
        <ActionButton actionId="app.contextMenu.open" params={{ menuId: "app.more" }} label="More" className={styles.icon}>
          <Icon name="more" size={18} />
        </ActionButton>
      </header>
    );
  }

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <PhotonWordmark size={18} className={styles.brand} />
        <ActionButton
          actionId="library.folder.open"
          className={styles.folderButton}
          label={folder ? `Open Folder… (currently “${folder.name}”)` : undefined}
        >
          <Icon name="folder" />
          <span className={styles.folderName}>{folder ? folder.name : "Open Folder…"}</span>
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
        <ActionButton actionId="develop.export" className={styles.icon}>
          <Icon name="export" />
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
        <AccountMenu />
      </div>
    </header>
  );
}
