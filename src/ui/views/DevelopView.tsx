import { useState } from "react";
import type { Histogram } from "../../core/develop/pipeline";
import { CropOverlay } from "../develop/CropOverlay";
import { DevelopCanvas } from "../develop/DevelopCanvas";
import { DevelopPanel } from "../develop/DevelopPanel";
import { MaskOverlay } from "../develop/MaskOverlay";
import { defaultRecipe } from "../../core/develop/recipe";
import { LAYOUT_LIMITS } from "../../core/state/layout";
import { useAppState, useDispatch } from "../hooks";
import { useLongPress, useSwipe, type Point } from "../hooks/gestures";
import { useMobileLayout, useStackedDevelop } from "../hooks/media";
import { DockablePanel } from "../layout/DockablePanel";
import { ResizeHandle } from "../layout/ResizeHandle";
import { Icon } from "../shell/Icon";
import { Filmstrip, FilmstripCollapsed } from "./Filmstrip";
import { InfoOverlay } from "./PhotoStage";
import styles from "./DevelopView.module.css";

/** Stacked layout (small screens): the panel's height limits, and its share of the window to start with. */
const SHEET = { min: 160, share: 0.42, reserve: 220 };

export function DevelopView() {
  const photo = useAppState((s) => (s.selection.activeId ? s.photos.byId[s.selection.activeId] : undefined));
  const beforeAfter = useAppState((s) => s.beforeAfter);
  const filmstrip = useAppState((s) => s.filmstrip);
  const cropTool = useAppState((s) => s.develop.cropTool);
  const levelTool = useAppState((s) => s.develop.levelTool);
  const maskTool = useAppState((s) => s.develop.maskTool);
  const info = useAppState((s) => s.infoOverlay);
  const { panelDocked, panelSide, panelWidth } = useAppState((s) => s.layout);
  const mobile = useMobileLayout();
  const stacked = useStackedDevelop();
  const dispatch = useDispatch();
  const [histogram, setHistogram] = useState<Histogram | null>(null);
  // Small screens stack the panel under the photo as a sheet; its height and whether it is open are chrome, not settings.
  const [sheetOpen, setSheetOpen] = useState(true);
  const [sheetHeight, setSheetHeight] = useState(() => Math.max(SHEET.min, Math.round(window.innerHeight * SHEET.share)));

  const openMenu = (at: Point) => void dispatch("app.contextMenu.open", { menuId: "loupe.photo", x: at.x, y: at.y });
  const press = useLongPress(openMenu);
  const swipe = useSwipe((direction) => void dispatch(direction < 0 ? "navigation.next" : "navigation.previous"));

  if (!photo) return <div className={styles.layout} />;
  const recipe = photo.edit ?? defaultRecipe();
  const crop = recipe.crop;
  const selectedMask = recipe.masks.find((m) => m.id === maskTool.selectedId) ?? null;
  // Handles for the selected mask (or drawing a new one) replace the swipe gesture, as the crop tool does.
  const masking = !cropTool && !beforeAfter && (selectedMask !== null || maskTool.drawing !== null);

  const stage = (
    <div
      className={`${styles.stage} ${cropTool || masking ? "" : styles.swipeable}`}
      {...press}
      {...(cropTool || masking ? {} : swipe)}
      onContextMenu={(e) => {
        press.onContextMenu(e);
        if (e.defaultPrevented) return;
        e.preventDefault();
        openMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <DevelopCanvas
        key={photo.id}
        photo={photo}
        original={beforeAfter}
        ignoreCrop={cropTool && !beforeAfter}
        onHistogram={setHistogram}
        showMask={masking && maskTool.overlay && selectedMask ? selectedMask.id : undefined}
        overlay={
          cropTool && !beforeAfter
            ? (display) => <CropOverlay crop={crop} display={display} levelTool={levelTool} />
            : masking
              ? (display) => <MaskOverlay photo={photo} mask={selectedMask} crop={crop} display={display} drawing={maskTool.drawing} />
              : undefined
        }
      />
      {beforeAfter && <span className={styles.badge}>Before</span>}
      {info && <InfoOverlay photo={photo} />}
    </div>
  );

  if (stacked) {
    const maxHeight = Math.max(SHEET.min, window.innerHeight - SHEET.reserve);
    return (
      <div className={`${styles.layout} ${styles.stacked}`}>
        <div className={styles.main}>
          {stage}
          {filmstrip ? <Filmstrip /> : <FilmstripCollapsed />}
        </div>
        {sheetOpen ? (
          <>
            <ResizeHandle
              orientation="horizontal"
              label="Develop panel height"
              value={sheetHeight}
              min={SHEET.min}
              max={maxHeight}
              grow={-1}
              onResize={setSheetHeight}
              onReset={() => setSheetHeight(Math.round(window.innerHeight * SHEET.share))}
            />
            <div className={styles.sheet} style={{ height: Math.min(sheetHeight, maxHeight) }}>
              <DockablePanel title="Develop" fixed onCollapse={() => setSheetOpen(false)}>
                <DevelopPanel photo={photo} histogram={histogram} />
              </DockablePanel>
            </div>
          </>
        ) : (
          <button type="button" className={styles.expand} aria-label="Show Develop panel" onClick={() => setSheetOpen(true)}>
            <Icon name="chevronUp" size={14} />
            <span>Develop</span>
          </button>
        )}
      </div>
    );
  }

  // Docked: [panel | handle | stage] or [stage | handle | panel]. Floating: the stage alone; the panel is position: fixed.
  // A phone held sideways has no room for a floating panel: it stays docked (the remembered choice is kept).
  const docked = panelDocked || mobile;
  const columns = !docked ? "minmax(0, 1fr)" : panelSide === "left" ? `${panelWidth}px auto minmax(0, 1fr)` : `minmax(0, 1fr) auto ${panelWidth}px`;
  const panel = (
    <DockablePanel title="Develop" fixed={mobile}>
      <DevelopPanel photo={photo} histogram={histogram} />
    </DockablePanel>
  );
  const handle = docked && (
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
      {docked && panelSide === "left" && (
        <>
          {panel}
          {handle}
        </>
      )}
      <div className={styles.main}>
        {stage}
        {filmstrip ? <Filmstrip /> : <FilmstripCollapsed />}
      </div>
      {docked && panelSide === "right" && (
        <>
          {handle}
          {panel}
        </>
      )}
      {!docked && panel}
    </div>
  );
}
