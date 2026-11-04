import { useState } from "react";
import type { Histogram } from "../../core/develop/pipeline";
import { CropOverlay } from "../develop/CropOverlay";
import { DevelopCanvas } from "../develop/DevelopCanvas";
import { DevelopPanel } from "../develop/DevelopPanel";
import { defaultRecipe } from "../../core/develop/recipe";
import { LAYOUT_LIMITS } from "../../core/state/layout";
import { useAppState, useDispatch } from "../hooks";
import { DockablePanel } from "../layout/DockablePanel";
import { ResizeHandle } from "../layout/ResizeHandle";
import { Filmstrip } from "./Filmstrip";
import { InfoOverlay } from "./PhotoStage";
import styles from "./DevelopView.module.css";

export function DevelopView() {
  const photo = useAppState((s) => (s.selection.activeId ? s.photos.byId[s.selection.activeId] : undefined));
  const beforeAfter = useAppState((s) => s.beforeAfter);
  const filmstrip = useAppState((s) => s.filmstrip);
  const cropTool = useAppState((s) => s.develop.cropTool);
  const levelTool = useAppState((s) => s.develop.levelTool);
  const info = useAppState((s) => s.infoOverlay);
  const { panelDocked, panelSide, panelWidth } = useAppState((s) => s.layout);
  const dispatch = useDispatch();
  const [histogram, setHistogram] = useState<Histogram | null>(null);

  if (!photo) return <div className={styles.layout} />;
  const crop = (photo.edit ?? defaultRecipe()).crop;

  // Docked: [panel | handle | stage] or [stage | handle | panel]. Floating: the stage alone; the panel is position: fixed.
  const columns = !panelDocked ? "minmax(0, 1fr)" : panelSide === "left" ? `${panelWidth}px auto minmax(0, 1fr)` : `minmax(0, 1fr) auto ${panelWidth}px`;
  const panel = (
    <DockablePanel title="Develop">
      <DevelopPanel photo={photo} histogram={histogram} />
    </DockablePanel>
  );
  const handle = panelDocked && (
    <ResizeHandle
      orientation="vertical"
      label="Develop panel width"
      value={panelWidth}
      min={LAYOUT_LIMITS.panelWidth.min}
      max={LAYOUT_LIMITS.panelWidth.max}
      grow={panelSide === "left" ? 1 : -1}
      onResize={(width) => void dispatch("view.panel.resize", { width })}
      onReset={() => void dispatch("view.panel.resize")}
    />
  );

  return (
    <div className={styles.layout} style={{ gridTemplateColumns: columns }}>
      {panelDocked && panelSide === "left" && (
        <>
          {panel}
          {handle}
        </>
      )}
      <div className={styles.main}>
        <div className={styles.stage}>
          <DevelopCanvas
            key={photo.id}
            photo={photo}
            original={beforeAfter}
            ignoreCrop={cropTool && !beforeAfter}
            onHistogram={setHistogram}
            overlay={cropTool && !beforeAfter ? (display) => <CropOverlay crop={crop} display={display} levelTool={levelTool} /> : undefined}
            onContextMenu={(e) => {
              e.preventDefault();
              void dispatch("app.contextMenu.open", { menuId: "loupe.photo", x: e.clientX, y: e.clientY });
            }}
          />
          {beforeAfter && <span className={styles.badge}>Before</span>}
          {info && <InfoOverlay photo={photo} />}
        </div>
        {filmstrip && <Filmstrip />}
      </div>
      {panelDocked && panelSide === "right" && (
        <>
          {handle}
          {panel}
        </>
      )}
      {!panelDocked && panel}
    </div>
  );
}
