import { allActions } from "../../src/actions";
import type { PixelData } from "../../src/core/develop/auto";
import type { MaskBitmap } from "../../src/core/develop/masks";
import { MemoryMetadataStore } from "../../src/adapters/db";
import { NullPreviewService } from "../../src/adapters/previews/preview-service";
import { SampleSource } from "../../src/adapters/sample-source";
import { MemorySettingsStore } from "../../src/adapters/settings";
import { StubAIProvider } from "../../src/adapters/stub-ai-provider";
import type { AnyAction } from "../../src/core/actions/types";
import type { MenuDefinition } from "../../src/core/menus/registry";
import { createRuntime, type Runtime } from "../../src/core/runtime";
import type { LibraryProvider, PhotoIndexData, PhotoSource, PreviewService } from "../../src/core/services";
import type { Account, PhotoRecord } from "../../src/core/state/types";
import { allMenus } from "../../src/menus";

/** Library provider for tests: the sample library, plus folders a test hands it. */
export class TestLibraryProvider implements LibraryProvider {
  active: PhotoSource | null = null;
  /** What the next pickFolder() "chooses"; null simulates cancel. */
  nextPick: PhotoSource | null = null;
  restore: Awaited<ReturnType<LibraryProvider["restoreLast"]>> = null;
  private known = new Map<string, PhotoSource>();

  constructor(private readonly sampleCount = 10) {}

  current() {
    return this.active;
  }
  async pickFolder() {
    if (this.nextPick) {
      this.known.set(this.nextPick.folder.id, this.nextPick);
      this.active = this.nextPick;
    }
    return this.nextPick;
  }
  async openSample() {
    return (this.active = new SampleSource(this.sampleCount));
  }
  async restoreLast() {
    if (this.restore && "source" in this.restore) this.active = this.restore.source;
    return this.restore;
  }
  async reconnect(folderId: string) {
    const s = this.known.get(folderId) ?? null;
    if (s) this.active = s;
    return s;
  }
  async recentFolders() {
    return [...this.known.values()].map((s) => s.folder);
  }
}

/** Index data from a lookup table instead of decoding files. */
export class FakePreviews extends NullPreviewService implements PreviewService {
  /** Pretend every photo decodes (tests can't create real ImageBitmaps in Node). */
  override async decode() {
    return { width: 100, height: 50, close() {} } as unknown as ImageBitmap;
  }
  /** Pixels for readPixels by photo id; others are flat mid-grey. Null makes a photo undecodable. */
  pixels: Record<string, PixelData | null> = {};
  constructor(private readonly data: Record<string, PhotoIndexData> = {}) {
    super();
  }
  override async readIndexData(photo: PhotoRecord) {
    return this.data[photo.id] ?? {};
  }
  override async readPixels(photo: PhotoRecord) {
    return photo.id in this.pixels ? this.pixels[photo.id]! : solidImage(128, 128, 128);
  }
}

/** A synthetic RGBA image: fill(x, y) gives 0–255 RGB at each pixel (x, y in 0–1). */
export function makeImage(width: number, height: number, fill: (x: number, y: number) => [number, number, number]): PixelData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill((x + 0.5) / width, (y + 0.5) / height);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

export const solidImage = (r: number, g: number, b: number) => makeImage(16, 16, () => [r, g, b]);

export interface TestRuntime extends Runtime {
  auth: { signedOut: number; passkeys: number };
  downloads: Array<{ fileName: string; content: string }>;
  exports: Array<{ recipe: unknown; opts: unknown }>;
  /** Segmentation requests made (photo id and target); a target listed in `segmentFails` rejects. */
  segmentations: Array<{ photoId: string; target: string }>;
  segmentFails: Set<string>;
  library: TestLibraryProvider;
  metadata: MemoryMetadataStore;
}

/** A 4×4 mask: the top half (rows 0–1) fully covered, the bottom half not. */
export const fakeMaskBitmap = (): MaskBitmap => ({ width: 4, height: 4, data: new Uint8ClampedArray([...Array(8).fill(255), ...Array(8).fill(0)]) });

export async function createTestRuntime(
  opts: {
    isMac?: boolean;
    photos?: number;
    actions?: readonly AnyAction[];
    menus?: readonly MenuDefinition[];
    previews?: PreviewService;
    loadSample?: boolean;
    account?: Account | null;
  } = {},
): Promise<TestRuntime> {
  const downloads: TestRuntime["downloads"] = [];
  const exports: TestRuntime["exports"] = [];
  const segmentations: TestRuntime["segmentations"] = [];
  const segmentFails = new Set<string>();
  const library = new TestLibraryProvider(opts.photos ?? 10);
  const metadata = new MemoryMetadataStore();
  const auth = { signedOut: 0, passkeys: 0, signOut: async () => void auth.signedOut++, addPasskey: async () => (auth.passkeys++, { name: "Test Passkey" }) };
  const runtime = createRuntime({
    actions: opts.actions ?? allActions,
    menus: opts.menus ?? allMenus,
    platform: { isMac: opts.isMac ?? false, prefersDark: () => false },
    initialState: { account: opts.account ?? null },
    services: {
      auth,
      settings: new MemorySettingsStore(),
      library,
      metadata,
      previews: opts.previews ?? new FakePreviews(),
      persistence: { flush: async () => undefined },
      vision: {
        capture: async (photo, opts) => ({ photoId: photo.id, mediaType: "image/jpeg" as const, data: "AAAA", width: opts.maxEdge, height: Math.round(opts.maxEdge * 2 / 3), edited: opts.edited && !!photo.edit }),
      },
      exporter: {
        renderJpeg: async (_image, recipe, opts) => {
          exports.push({ recipe, opts });
          return { blob: new Blob(["jpeg"], { type: "image/jpeg" }), width: 100, height: 50 };
        },
      },
      segmentation: {
        loading: null,
        onLoading: () => () => undefined,
        segment: async (photo, target) => {
          segmentations.push({ photoId: photo.id, target });
          if (segmentFails.has(target)) throw new Error(`Can't detect ${target}`);
          return fakeMaskBitmap();
        },
      },
      ai: new StubAIProvider(),
      downloads: {
        save: (fileName, content) => downloads.push({ fileName, content }),
        saveBlob: (fileName) => downloads.push({ fileName, content: "<blob>" }),
      },
    },
  });
  await runtime.keybindings.load();
  if (opts.loadSample !== false && runtime.registry.get("library.sample.load")) await runtime.dispatch("library.sample.load");
  return Object.assign(runtime, { auth, downloads, exports, segmentations, segmentFails, library, metadata });
}

export function key(
  key: string,
  mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {},
  target?: unknown,
) {
  let prevented = false;
  return {
    key,
    code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : "",
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
    target,
    preventDefault() {
      prevented = true;
    },
    get prevented() {
      return prevented;
    },
  };
}

/** Let fire-and-forget dispatches settle (microtasks only, so it works with fake timers). */
export async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** Wait for background work that uses real timers (indexing batches, debounced saves). */
export const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
