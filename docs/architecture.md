# Architecture

Photo is a client-side photo culling and editing app. Everything the user (or an AI, or a script) can do is an **action** in one registry. There is one way to change state: dispatch an action.

```
 keyboard ─┐
 buttons ──┤                        ┌─► Zustand store (AppState)
 palette ──┼─► Dispatcher ──────────┤      ▲
 AI plan ──┤   • find action        │      │ Immer patches
 scripts ──┘   • check `when`       └─► History (undo / redo / transactions)
               • validate (Zod)
               • run(params, ctx)
```

## Layers

| Folder | Contents | May import |
| --- | --- | --- |
| `src/core/` | Registry, dispatcher, history, keybindings, manifest, store, service interfaces | zod, immer, zustand/vanilla only. **No React, no DOM.** |
| `src/actions/` | Action definitions, grouped by domain | `core` |
| `src/adapters/` | Browser implementations of the service interfaces | `core`, browser APIs |
| `src/ui/` | React components and hooks | everything |
| `scripts/` | Build-time tools (manifest generator) | `core`, `actions` |

Because `core` and `actions` are DOM-free, the generator and the unit tests import the real registry in Node.

## Key pieces

**Action registry** (`core/actions/registry.ts`). Holds `ActionDefinition`s. It rejects malformed or duplicate ids, and queries marked undoable.

**Dispatcher** (`core/actions/dispatcher.ts`). The only entry point for running actions. It returns a `DispatchResult` (`ok` / `unknown_action` / `unavailable` / `invalid_params` / `failed`) and never throws. It tags every call with its source (`keyboard`, `palette`, `ui`, `ai`, `script`).

**State and undo** (`core/state`, `core/history`). History entries can also carry *effects*: side effects outside app state, such as moving files, recorded with `ctx.recordEffect({ undo, redo })` from an undoable command. Effects run before the patches on undo and redo. If one fails, the step is left as it was (effects are all-or-nothing). Commands with a `coalesce(params)` key merge consecutive runs into one step, for example a slider drag. Actions change state only through `ctx.update(draft => …)`. For `undoable` commands, the Immer patches are recorded. `dispatcher.transaction(label, fn)` merges every undoable change made inside `fn` into one history entry, and rolls everything back if `fn` throws. If one command fails inside a transaction, only that command's own changes are rolled back. Selection, view and theme changes are deliberately not undoable, as in Lightroom.

**`when` clauses** (`core/actions/when.ts`). An availability condition is a `{ test, describe }` pair built from combinators (`inView("develop")`, `hasSelection`, `all(...)`). The `describe` text is what the manifest shows ("Available only when the current view is Develop.").

**Keybindings** (`core/keybindings`). `combo.ts` parses, normalises and formats key combos (`mod` = ⌘ on Mac, Ctrl elsewhere; chords are space-separated). `service.ts`:
- resolves defaults (`defaultShortcuts`) and user overrides (persisted under `keybindings.overrides`)
- matches key events, including multi-key chords
- respects `when` and text-input focus
- reports conflicts
- imports and exports JSON

A binding can carry params, so keys `0`–`5` all bind `library.rating.set` with different ratings. A binding with no params, for an action that needs them, opens the palette on that action's parameter step.

**Command palette** (`ui/palette`). Rows come from the registry plus the current bindings. A binding with params becomes a one-step "variant" row ("Rate ★★★"). Search uses match-sorter: every term must match, and ties break by recency. The parameter form is generated from the same JSON Schema the AI sees. `?` switches to natural-language mode, which dispatches `app.ai.ask`.

**Context menus** (`core/menus`, `src/menus`). A menu is data: action references (with params), separators and submenus. Labels, availability (`when`) and shortcuts come from the registry, so a menu can't drift from its actions. `app.contextMenu.open` opens one (Shift+F10 or the ContextMenu key next to the active photo). Right-clicking outside the selection selects that photo first, as in Lightroom. Menus are included in the manifest and SKILL.md. The renderer (`ui/menus/ContextMenu.tsx`) follows the WAI-ARIA menu pattern: arrow keys, type-ahead and submenus.

**Internal actions.** `internal: true` marks plumbing such as `library.index.apply` (applying background EXIF results). These are validated and dispatched like any action, so every state change still goes through the dispatcher. They are hidden from the palette, shortcuts screen and manifest.

**Auto-advance.** Rating, flag and label commands call `maybeAdvance()` (`src/actions/context.ts`). The mode is `capsLock` (the default), `always` or `never` (`app.autoAdvance.set`). It applies only to interactive sources (keyboard, palette, menu, ui) and to a single active photo. AI and scripts advance only with `advance: true`. The UI records Caps Lock from each key or mouse event into `runtime.input`, and actions read it as `ctx.input.capsLock`.

## Library, previews and storage

```
LibraryProvider ── pickFolder / restoreLast / reconnect ──► PhotoSource (FsAccess | FileList | Sample | Memory)
      │                                                         │ listFiles, getFile, read/writeSidecar
loadSource()  ── files + MetadataStore + sidecars ──► photos in the store ──► indexPhotos() ─► library.index.apply
      │                                                                        (EXIF via PreviewService worker)
MetadataSync ◄── store diff (rating/flag/label changed, by any cause incl. undo) ──► MetadataStore + XMP sidecars
```

- **Sources.** `FsAccessSource` uses the File System Access API. Its directory handle is kept in IndexedDB, so the folder reopens next session, or shows a "Reconnect" prompt if the browser wants permission again. `FileListSource` is the read-only fallback for Safari, iPad and Firefox (`<input webkitdirectory>`, or a multi-file picker). Photo ids are relative paths.
- **Previews** (`adapters/previews`). A worker pool decodes thumbnails and reads EXIF (exifr). Visible thumbnails jump the queue, newest first, and are cancelled when scrolled away; EXIF indexing fills idle workers. Thumbnails are cached in IndexedDB, keyed by path and size+mtime. Loupe and Develop show the original file through an object URL, so the browser decodes and orients it.
- **RAW** (`adapters/raw/raw-decoder.ts`). LibRaw in WebAssembly (`libraw-wasm`, loaded on first use; it runs in its own worker and needs cross-origin isolation). Opening a file only parses its header, so metadata and the embedded JPEG preview are cheap; demosaicing is the slow part. Two LibRaw instances ("lanes") keep a long decode from holding up thumbnails, and each is disposed after a minute idle to free its memory. `BrowserPreviewService` routes RAW files by MIME type: thumbnails and Loupe from the embedded preview (oriented in the preview worker), Develop/export from a decode (half size when that covers `maxEdge`), small decodes (AI vision, edited thumbnails) from the preview when it is big enough. The image size recorded for a RAW always comes from LibRaw, because EXIF sizes in RAW files often describe a preview. Sources list every image file; `selectPairs` (`core/state/selectors.ts`, over `pairRawWithJpeg` in `core/library/formats.ts`) finds RAW+JPEG pairs, and while `library.groupRawJpeg` is on (`library.pairs.set`, persisted) `selectLibraryIds` hides each pair's JPEG and `removePhotos` moves it with its RAW, like a sidecar.
- **Metadata.** `DexieMetadataStore` keeps rating, flag, label, and the cached EXIF per folder and path. `MetadataSync` writes after a short debounce and on tab hide.
- **XMP sidecars** (`core/xmp`). Read on load; a sidecar edited after our last save wins. Written only with readwrite permission. Writes go to an existing `name.ext.xmp` or `name.xmp`, or create a new `name.xmp`. Edits are in place and keep everything else in the file. A corrupt sidecar is never overwritten. Rejected photos are written as `xmp:Rating="-1"` (Bridge/darktable convention); the exact rating and pick flag go in this app's own namespace. Lightroom Classic reads sidecars for raw files only; for JPEGs it reads embedded XMP, which this app never writes.
- **Removing photos** (`core/library/trash.ts`). `library.rejected.remove` (⌘⌫) moves rejected photos and their sidecars into `_Rejected/` at the folder root, keeping their relative paths. It waits for pending sidecar writes first. It is undoable: ⌘Z moves the files back and restores the previous state, and restoring is undoable too. The library never lists `_Rejected`, and the filter bar shows how many photos are in it. `library.removed.restore` moves them back, refusing to overwrite a file that has reappeared at the original path. `library.removed.empty` is the only operation that deletes files. It needs `{ confirm: true }` (the UI asks first) and deletes permanently, because browsers can't use the system Trash. It clears undo history, since earlier removals can no longer be reversed. Moves use the native `FileSystemHandle.move()` where supported; otherwise they copy, check the size, and only then delete the original. Read-only folders (Safari/iPad fallback, sample library) can't remove photos; the filter can hide rejects instead.
- **Image file contents are never modified.** Files are only moved into `_Rejected` (and back) on request, and only deleted when the user empties it.

## Develop

```
EditRecipe (per photo, in the store) ──► uniformsFor() ──► DevelopRenderer (WebGL2) ──► preview canvas / histogram
        │                                     │                     └─ export.worker: OffscreenCanvas ─► JPEG ─► _Exports/
        └─ MetadataSync ─► IndexedDB + XMP photo:Edit                └─ edited thumbnails (shared context)
```

- **Recipe** (`core/develop/recipe.ts`). A Zod schema with neutral defaults: white balance (temperature, tint), exposure, contrast, highlights, shadows, whites, blacks, vibrance, saturation, a post-crop vignette, a master tone curve, HSL for 8 colour bands, crop/straighten, and an optional profile. Sliders default to neutral when parsing, so recipes saved before a slider existed still load. A photo with default settings has no `edit` at all. Groups (`profile`, `wb`, `basic`, `presence`, `effects`, `toneCurve`, `hsl`, `crop`) drive reset, copy/paste and sync. The default copy excludes crop, as in Lightroom. Actions change recipes through `updateEdits`, which computes each new recipe from the committed state and only assigns it inside the Immer draft (browsers can't `structuredClone` a draft).
- **Pipeline** (`core/develop/pipeline.ts`). The pixel maths, specified once in TypeScript: sRGB → linear → white balance and exposure → tone on perceptual luminance, applied as a luminance ratio so hues don't shift → vignette by position in the cropped frame → sRGB → profile → HSL bands, vibrance and saturation.
- **Profiles** (`core/develop/profiles.ts`, `actions/profiles.ts`). A profile is a look under the sliders, as in Lightroom: a black and white channel mix or saturation, per-channel curves, split toning, fade and grain, blended by an amount (0–200%). The R, G and B curves share the RGBA lookup texture with the master tone curve (in A). Grain is smooth value noise from an integer hash, identical in JS and GLSL, placed by source-image position so it is the same at any render size. Built-ins (`builtin.…`) are code; the user's own (`user.…`) are in `state.develop.profiles`: created, edited, deleted and imported by undoable actions, saved to local settings by `ui/develop/profile-sync.ts` (never during an AI preview), and exported as `photo-profiles` JSON files. A recipe's `profile` holds a copy of the look, so a sidecar renders the same where the profile isn't installed; editing a profile updates the photos in the open folder that use it.
- **Auto** (`core/develop/auto.ts`, `develop.auto`). `PreviewService.readPixels` gives a ≤256px image (from the cached thumbnail where possible). A 64×64 sample inside the crop is run through the CPU pipeline, so the result accounts for the profile and lands the same on the GPU: grey-world white balance refined on near-neutral pixels (damped); exposure only when the median leaves a mid-tone band; highlight/shadow recovery from clipped pixels; whites/blacks stretched (never pulled in) by bisection at ends that aren't clipped; contrast from the 10–90% spread; a little vibrance. Photos are analysed four at a time and applied as one undo step. `adapters/render/shaders.ts` implements the same formulas in GLSL. `tests/e2e/develop-pipeline.spec.ts` renders a test image on the GPU and checks every pixel against the CPU reference (within a few 8-bit levels).
- **Tone curve.** A monotone cubic through the control points (it never overshoots), sampled into an 8-bit lookup table texture.
- **Crop** (`core/develop/crop.ts`). The rectangle lives in the straightened frame. `constrainCrop` keeps it inside the rotated photo by shrinking it about its centre, as Lightroom does. The shader maps output uv to source uv with a single affine transform. In the crop tool, dragging outside the rectangle rotates (`rotateByDrag`, recomputed from the crop at the start of the drag so rotating back regrows it), and a line drawn along a horizon or vertical edge sets the angle that levels it (`levelAngle`, via `develop.crop.level`).
- **Renderer** (`core/develop/renderer.ts`). A backend-neutral interface; `WebGL2Renderer` works on a canvas or an OffscreenCanvas, and a WebGPU backend can implement the same interface. The preview decodes at a 2560px long edge (full size for 100% zoom in Loupe). The histogram comes from a 256px off-screen render of the final, cropped image.
- **Undo.** Develop commands set `coalesce` keys, so a slider drag or crop drag is one undo step.
- **Export** (`develop.export`). The image is decoded at full resolution (oriented), rendered in a worker, and encoded as JPEG. It is written to `_Exports/` without overwriting anything (`name-2.jpg`, …), or downloaded for read-only folders. EXIF isn't copied into exports yet.
- **Edits in Loupe and thumbnails.** Edited photos render through the pipeline in Loupe. The grid and filmstrip re-render the cached thumbnail with the recipe once editing pauses.

## AI

```
palette "?" ─► app.ai.ask ─► AIProvider (Anthropic, from the browser with the user's key)
                 │   manifest (cached system prefix) + context + read-only query tools
                 │   └─ the model may call queries: library.photos.list, develop.settings.get,
                 │      library.photos.view (images, with edits) … then returns a structured plan
                 ▼
          reviewPlan(): each step checked against the registry and its Zod schema
                 ▼
   AI panel: toggle/edit steps ─► PlanRunner.preview() ─► live state (no history, nothing persisted)
                 ▼ Apply
   PlanRunner.apply(): one dispatcher transaction "AI: …" (source "ai") ─► one ⌘Z undoes it
```

- **Provider** (`adapters/ai/anthropic-provider.ts`). Uses `@anthropic-ai/sdk` with `dangerouslyAllowBrowser`. The key and model live in local storage via `app.ai.configure`, which is internal so the key never passes through a plan; errors are redacted. Defaults: `claude-opus-5-5` (Sonnet 5.5 and Haiku 5.5 can be chosen in AI Settings), `effort: "medium"`, server-side refusal fallback (`fallbacks: "default"`), and structured output (`betaZodOutputFormat`) for the plan. Step params arrive as JSON strings and are validated per action. The instructions and the manifest form a cached prefix, and the per-request context goes in the user turn.
- **Tools.** Every public query action is offered as a tool (dots become underscores in names). Only read-only queries can run while planning; tool results over 60k characters are truncated with an explicit note.
- **Vision.** `library.photos.view` returns `{ kind: "images" }`, which the provider sends as image content blocks. `BrowserVisionService` decodes the photo, applies the edit on the GPU unless asked for the original, and encodes a JPEG at a 512, 1024 or 1568px long edge, with per-size limits per call.
- **Review** (`core/ai/plan.ts`). Unknown, internal, query and AI/history/shortcut actions are rejected; params are validated; each step gets a label and an impact ("on 12 photos", from `targets` or the selection). Steps with `sideEffects` (file moves, export, folder loading) never preview; they run on Apply.
- **Conversation** (`core/ai/thread.ts`, `state.ai.thread`). Every message, suggestion and error is a turn, saved per folder in local storage (`ui/ai/thread-sync.ts`). Earlier exchanges are replayed verbatim (`sent` / `reply`) with a cache breakpoint on the last one. Each new message carries fresh `<app_context>` and a `<suggestion_status>` block: for every earlier suggestion, whether it was applied, which steps, whether params were edited, or whether it was left unapplied or dismissed. Applying marks the suggestion inside the same transaction (`app.ai.suggestion.mark`), so undo reverts the edits and the status together. Any unapplied suggestion can be reviewed and applied later. The panel opens and closes with ⌘J (`app.ai.panel.toggle`).
- **Preview** (`core/ai/plan-runner.ts`). Snapshots the state, runs the previewable steps with history recording suspended, and sets `ai.previewing`. `MetadataSync` ignores previews, and a dispatch guard refuses other edits until the preview ends. Ending restores the snapshot exactly.

**Services** (`core/services`). `SettingsStore`, `LibraryProvider`/`PhotoSource`, `MetadataStore`, `PreviewService`, `ExportService`, `VisionService`, `AIProvider` and `DownloadService` are interfaces, with browser implementations in `src/adapters` (and in-memory ones for tests). A server backend can replace any of them without touching actions.

**Runtime** (`core/runtime.ts`). `createRuntime()` wires everything together. The browser calls it from `ui/bootstrap.ts`, and tests call it from `tests/unit/helpers.ts`. In the browser, `window.photo.dispatch(...)` exposes the same dispatcher for scripting and end-to-end tests.

## URL state

`ui/url-state.ts` keeps `?folder=…&view=…&photo=…` in sync with the store. View changes push a history entry (Back returns to the previous view); photo changes replace it. On load and on back/forward, the target is applied through `library.selection.set` and `view.set` once the matching folder has loaded. A link for a different folder is dropped, and the URL is rewritten to match what is shown. A folder that needs permission keeps the target until it is reconnected.

## Layout

`state.layout` (`core/state/layout.ts`) holds where the Develop panel sits (docked left or right, or floating with a position and size) and how wide it and the filmstrip are. It changes only through the `view.panel.*` and `view.filmstrip.resize` actions (`actions/layout.ts`), which clamp values and save the whole slice to local settings; `view.layout.restore` applies it at startup. F7 docks/undocks the panel and Shift+F7 swaps its side; F6 (`view.filmstrip.toggle`) hides the strip, which leaves a slim bar with a button to bring it back. None of it is undoable. In the UI, `ui/layout/ResizeHandle` is a keyboard-accessible `separator` driven by the pointer-capture `useDrag` hook, and `ui/layout/DockablePanel` wraps the Develop panel: dragging its header past a few pixels undocks it (`view.panel.undock` at the pointer), later moves are `view.panel.float.set`, and releasing within 32px of a window edge docks it there (`view.panel.dock`). Floating position is clamped to the viewport in CSS, so a smaller window never hides the header.

## Theming

`ui/styles/tokens.css` defines semantic tokens (`--surface-panel`, `--accent`, `--text-muted`, …) with one block per theme, selected by `data-theme` on `<html>`. Components use CSS Modules and only reference tokens. A new theme is a new block, and runtime themes can set the variables directly.
