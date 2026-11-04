import { useAppState } from "../hooks";
import { Filmstrip, FilmstripCollapsed } from "./Filmstrip";
import { PhotoStage } from "./PhotoStage";
import styles from "./LoupeView.module.css";

export function LoupeView() {
  const filmstrip = useAppState((s) => s.filmstrip);
  return (
    <div className={styles.layout}>
      <PhotoStage zoomable />
      {filmstrip ? <Filmstrip /> : <FilmstripCollapsed />}
    </div>
  );
}
