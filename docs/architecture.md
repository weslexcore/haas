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

**State and undo** (`core/state`, `core/history`). Actions change state only through `ctx.update(draft => …)`. For `undoable` commands, the Immer patches are recorded. `dispatcher.transaction(label, fn)` merges every undoable change made inside `fn` into one history entry, and rolls everything back if `fn` throws. If one command fails inside a transaction, only that command's own changes are rolled back. Selection, view and theme changes are deliberately not undoable, as in Lightroom.

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
- **Metadata.** `DexieMetadataStore` keeps rating, flag, label, and the cached EXIF per folder and path. `MetadataSync` writes after a short debounce and on tab hide.
- **XMP sidecars** (`core/xmp`). Read on load; a sidecar edited after our last save wins. Written only with readwrite permission. Writes go to an existing `name.ext.xmp` or `name.xmp`, or create a new `name.xmp`. Edits are in place and keep everything else in the file. A corrupt sidecar is never overwritten. Rejected photos are written as `xmp:Rating="-1"` (Bridge/darktable convention); the exact rating and pick flag go in this app's own namespace. Lightroom Classic reads sidecars for raw files only; for JPEGs it reads embedded XMP, which this app never writes.
- **Removing photos** (`core/library/trash.ts`). `library.rejected.remove` (⌘⌫) moves rejected photos and their sidecars into `_Rejected/` at the folder root, keeping their relative paths. It waits for pending sidecar writes first and clears undo history. The library never lists `_Rejected`, and the filter bar shows how many photos are in it. `library.removed.restore` moves them back, refusing to overwrite a file that has reappeared at the original path. `library.removed.empty` is the only operation that deletes files. It needs `{ confirm: true }` (the UI asks first) and deletes permanently, because browsers can't use the system Trash. Moves use the native `FileSystemHandle.move()` where supported; otherwise they copy, check the size, and only then delete the original. Read-only folders (Safari/iPad fallback, sample library) can't remove photos; the filter can hide rejects instead.
- **Image file contents are never modified.** Files are only moved into `_Rejected` (and back) on request, and only deleted when the user empties it.

**Services** (`core/services`). `SettingsStore`, `LibraryProvider`/`PhotoSource`, `MetadataStore`, `PreviewService`, `AIProvider` and `DownloadService` are interfaces, with browser implementations in `src/adapters` (and in-memory ones for tests). A server backend can replace any of them without touching actions.

**Runtime** (`core/runtime.ts`). `createRuntime()` wires everything together. The browser calls it from `ui/bootstrap.ts`, and tests call it from `tests/unit/helpers.ts`. In the browser, `window.photo.dispatch(...)` exposes the same dispatcher for scripting and end-to-end tests.

## Theming

`ui/styles/tokens.css` defines semantic tokens (`--surface-panel`, `--accent`, `--text-muted`, …) with one block per theme, selected by `data-theme` on `<html>`. Components use CSS Modules and only reference tokens. A new theme is a new block, and runtime themes can set the variables directly.
