import { allActions } from "../actions";
import { AUTO_ADVANCE_SETTINGS_KEY, THEME_SETTINGS_KEY } from "../actions/app";
import { BrowserDownloads } from "../adapters/browser-downloads";
import { DexieMetadataStore, PhotoDB } from "../adapters/db";
import { BrowserLibraryProvider } from "../adapters/library-provider";
import { BrowserPreviewService } from "../adapters/previews/preview-service";
import { LocalSettingsStore } from "../adapters/settings";
import { StubAIProvider } from "../adapters/stub-ai-provider";
import { detectMac } from "../core/keybindings/combo";
import { MetadataSync } from "../core/library/metadata-sync";
import { buildManifest } from "../core/manifest/build-manifest";
import { createRuntime, type Runtime } from "../core/runtime";
import type { Services } from "../core/services";
import { allMenus } from "../menus";
import { loadRecents } from "./palette/recents";
import { toast } from "./toasts";

declare global {
  interface Window {
    /** Scripting / automation entry point: the same dispatcher the UI uses. */
    photo?: {
      dispatch: Runtime["dispatch"];
      transaction: Runtime["dispatcher"]["transaction"];
      manifest: () => ReturnType<typeof buildManifest>;
      state: () => ReturnType<Runtime["store"]["getState"]>;
      /** Write pending rating/flag/label changes to storage and sidecars now. */
      flushMetadata: () => Promise<void>;
    };
  }
}

export async function createBrowserRuntime(): Promise<Runtime> {
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const db = new PhotoDB();
  const library = new BrowserLibraryProvider(db);
  const services: Services = {
    settings: new LocalSettingsStore(),
    library,
    metadata: new DexieMetadataStore(db),
    previews: new BrowserPreviewService(library, db),
    ai: new StubAIProvider(),
    downloads: new BrowserDownloads(),
  };
  const runtime = createRuntime({
    actions: allActions,
    menus: allMenus,
    platform: { isMac: detectMac(), prefersDark: () => darkQuery.matches },
    services,
  });

  const sync = new MetadataSync(runtime.store, services, { onError: (message) => toast(message, "error", 8000) });
  sync.start();
  // Don't lose the last few changes when the tab closes or is backgrounded.
  window.addEventListener("pagehide", () => void sync.flush());
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && void sync.flush());

  const { settings } = services;
  const [theme, autoAdvance] = await Promise.all([
    settings.get<string>(THEME_SETTINGS_KEY),
    settings.get<string>(AUTO_ADVANCE_SETTINGS_KEY),
  ]);
  await Promise.all([
    runtime.keybindings.load(),
    loadRecents(settings),
    theme ? runtime.dispatch("app.theme.set", { theme }) : null,
    autoAdvance ? runtime.dispatch("app.autoAdvance.set", { mode: autoAdvance }) : null,
  ]);

  // Not awaited: the UI renders straight away and shows loading progress.
  void runtime.dispatch("library.folder.restore", undefined, { source: "script" }).then((r) => {
    if (!r.ok) toast(r.message, "error");
  });

  window.photo = {
    dispatch: (id, params, opts) => runtime.dispatch(id, params, { source: "script", ...opts }),
    transaction: (label, fn, opts) => runtime.dispatcher.transaction(label, fn, { source: "script", ...opts }),
    manifest: () => buildManifest(runtime.registry, runtime.menus),
    state: () => runtime.store.getState(),
    flushMetadata: () => sync.flush(),
  };
  return runtime;
}
