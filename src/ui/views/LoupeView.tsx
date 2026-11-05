import { useAppState, useDispatch } from "../hooks";
import { useSwipe } from "../hooks/gestures";
import { useMobileLayout } from "../hooks/media";
import { Filmstrip, FilmstripCollapsed } from "./Filmstrip";
import { FilterBar } from "./FilterBar";
import { PhotoStage } from "./PhotoStage";
import styles from "./LoupeView.module.css";

export function LoupeView() {
  const filmstrip = useAppState((s) => s.filmstrip);
  const zoom = useAppState((s) => s.zoom);
  const cropTool = useAppState((s) => s.develop.cropTool);
  const mobile = useMobileLayout();
  const dispatch = useDispatch();
  // A finger swipe moves between photos while the whole photo is shown; at 100% the same gesture pans it.
  const swipe = useSwipe((direction) => void dispatch(direction < 0 ? "navigation.next" : "navigation.previous"));
  const swipeable = zoom === "fit" && !cropTool;
  return (
    <div className={styles.layout}>
      {!mobile && <FilterBar />}
      <div className={`${styles.stageWrap} ${swipeable ? styles.swipeable : ""}`} {...(swipeable ? swipe : {})}>
        <PhotoStage zoomable />
      </div>
      {filmstrip ? <Filmstrip /> : <FilmstripCollapsed />}
    </div>
  );
}
