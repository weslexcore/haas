import { useState } from "react";
import type { Histogram } from "../../core/develop/pipeline";
import { CropOverlay } from "../develop/CropOverlay";
import { DevelopCanvas } from "../develop/DevelopCanvas";
import { DevelopPanel } from "../develop/DevelopPanel";
import { defaultRecipe } from "../../core/develop/recipe";
import { useAppState, useDispatch } from "../hooks";
import { Filmstrip } from "./Filmstrip";
import { InfoOverlay } from "./PhotoStage";
import styles from "./DevelopView.module.css";

export function DevelopView() {
  const photo = useAppState((s) => (s.selection.activeId ? s.photos.byId[s.selection.activeId] : undefined));
  const beforeAfter = useAppState((s) => s.beforeAfter);
  const filmstrip = useAppState((s) => s.filmstrip);
  const cropTool = useAppState((s) => s.develop.cropTool);
  const info = useAppState((s) => s.infoOverlay);
  const dispatch = useDispatch();
  const [histogram, setHistogram] = useState<Histogram | null>(null);

  if (!photo) return <div className={styles.layout} />;
  const crop = (photo.edit ?? defaultRecipe()).crop;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <div className={styles.stage}>
          <DevelopCanvas
            key={photo.id}
            photo={photo}
            original={beforeAfter}
            ignoreCrop={cropTool && !beforeAfter}
            onHistogram={setHistogram}
            overlay={cropTool && !beforeAfter ? (display) => <CropOverlay crop={crop} display={display} /> : undefined}
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
      <DevelopPanel photo={photo} histogram={histogram} />
    </div>
  );
}
