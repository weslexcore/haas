import type { AnyAction } from "../core/actions/types";
import { ActionRegistry } from "../core/actions/registry";
import { accountActions } from "./account";
import { appActions } from "./app";
import { developActions } from "./develop";
import { historyActions } from "./history";
import { layoutActions } from "./layout";
import { libraryActions } from "./library";
import { maskActions } from "./masks";
import { navigationActions } from "./navigation";
import { profileActions } from "./profiles";
import { shortcutActions } from "./shortcuts";
import { trashActions } from "./trash";
import { viewActions } from "./view";

/** Every action in the app. Add new action modules here. */
export const allActions: readonly AnyAction[] = [
  ...appActions,
  ...accountActions,
  ...shortcutActions,
  ...viewActions,
  ...layoutActions,
  ...navigationActions,
  ...libraryActions,
  ...trashActions,
  ...developActions,
  ...maskActions,
  ...profileActions,
  ...historyActions,
];

export function createActionRegistry(): ActionRegistry {
  return new ActionRegistry().registerAll(allActions);
}
