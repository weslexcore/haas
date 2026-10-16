import { Dispatcher, type DispatchOptions } from "./actions/dispatcher";
import { ActionRegistry } from "./actions/registry";
import type { AnyAction, DispatchResult, Platform } from "./actions/types";
import { MenuRegistry, type MenuDefinition } from "./menus/registry";
import { PlanRunner } from "./ai/plan-runner";
import { History } from "./history/history";
import { KeybindingService } from "./keybindings/service";
import type { Services } from "./services";
import { createAppStore, type AppStore } from "./state/store";
import type { AppState } from "./state/types";

export interface RuntimeOptions {
  actions: readonly AnyAction[];
  menus?: readonly MenuDefinition[];
  services: Services;
  platform: Platform;
  initialState?: Partial<AppState>;
}

/** Everything the app needs, wired together. Framework-free so tests and scripts can create one. */
export interface Runtime {
  store: AppStore;
  history: History;
  registry: ActionRegistry;
  menus: MenuRegistry;
  /** Mutable live input state; the UI updates it from keyboard/mouse events. */
  input: { capsLock: boolean };
  dispatcher: Dispatcher;
  keybindings: KeybindingService;
  /** Previews and applies AI plans. */
  plans: PlanRunner;
  services: Services;
  platform: Platform;
  dispatch<R = unknown>(id: string, params?: unknown, opts?: DispatchOptions): Promise<DispatchResult<R>>;
}

/** Action that opens the palette on an action's parameter step. */
export const PARAM_PROMPT_ACTION_ID = "app.palette.open";

export function createRuntime(opts: RuntimeOptions): Runtime {
  const store = createAppStore(opts.initialState);
  const history = new History(store);
  const registry = new ActionRegistry().registerAll(opts.actions);
  const menus = new MenuRegistry().registerAll(opts.menus ?? []);
  const input = { capsLock: false };
  const dispatcher = new Dispatcher({
    registry,
    store,
    history,
    services: opts.services,
    platform: opts.platform,
    getKeybindings: () => keybindings, // created below; only read when an action runs
    menus,
    input,
  });
  const keybindings = new KeybindingService({
    registry,
    settings: opts.services.settings,
    isMac: opts.platform.isMac,
    getContext: () => dispatcher.readonlyContext(),
    dispatch: (id, params) => dispatcher.dispatch(id, params, { source: "keyboard" }),
    onMissingParams: (actionId) => {
      void dispatcher.dispatch(PARAM_PROMPT_ACTION_ID, { actionId }, { source: "keyboard" });
    },
  });
  const plans = new PlanRunner(store, history, dispatcher, registry);
  return {
    store,
    history,
    plans,
    registry,
    menus,
    input,
    dispatcher,
    keybindings,
    services: opts.services,
    platform: opts.platform,
    dispatch: (id, params, o) => dispatcher.dispatch(id, params, o),
  };
}
