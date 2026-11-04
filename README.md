# Photo

A browser-based photo culling and editing app, in the spirit of Lightroom. Everything is an action in a central registry. Buttons, keyboard shortcuts, the command palette, scripts and (soon) an AI all dispatch the same actions.

**Status:** Phase 4 (AI). You can open a real folder (File System Access API in Chromium, read-only fallback elsewhere) or the sample library, cull, edit non-destructively on the GPU, export JPEGs, and ask Claude in plain language. Claude can look at your photos; every plan is reviewed and previewed before it's applied as one undoable step.

```bash
yarn install
yarn dev              # http://localhost:5173
yarn verify           # typecheck + unit tests + manifest freshness
yarn e2e              # Playwright keyboard/palette tests (first run: yarn playwright install chromium)
yarn manifest         # regenerate generated/actions.json and generated/SKILL.md
```

## Try it

| Keys | Action |
| --- | --- |
| `⌘K` / `Ctrl+K` | Command palette (type `?` to ask Claude; set your API key in "AI Settings…") |
| `⌘J` / `Ctrl+J` | AI conversation panel: every suggestion, what was applied, follow-ups |
| `⌘/` / `Ctrl+/` | Keyboard Shortcuts: search, rebind, resolve conflicts, import/export |
| `G` `E` `D` | Grid, Loupe and Develop views |
| `←` `→` `Home` `End` | Previous, next, first and last photo |
| `⌘O` / `Ctrl+O` | Open folder |
| `0`–`5` | Set rating |
| `P` `X` `U` | Pick, reject, unflag |
| `6`–`9` | Toggle red, yellow, green, blue label |
| Caps Lock | Auto-advance after rating/flagging (configurable: "Set Auto-Advance" in the palette) |
| `Shift+F10`, right-click | Photo context menu |
| `Z`, `I` | Loupe zoom, info overlay |
| `=` `-`, or the slider in the filter bar | Larger or smaller Grid thumbnails (double-click the slider to reset) |
| `F6` | Show or hide the filmstrip (or the chevron at its top-right corner / along the bottom edge) |
| `F7`, `Shift+F7` | Undock or dock the Develop panel; move it to the other side |
| Drag the filmstrip's top edge, or the Develop panel's edge | Resize them (double-click resets; arrow keys work when focused) |
| Drag the Develop panel's header | Undock it and move it around; drop it against a window edge to dock it there (or use the header buttons) |
| `⌘L` / `Ctrl+L` | Clear filter |
| `⌘⌫` / `Ctrl+Backspace` | Remove rejected photos (moved to `_Rejected/`; restore or delete them from the filter bar) |
| `\` | Before/after (Develop only) |
| `R` | Crop & straighten tool (Loupe or Develop): drag outside the crop to rotate, ⌘/Ctrl-drag along a horizon to level it |
| `⌘⇧C` / `⌘⇧V` / `⌘⇧S` | Copy / paste / sync develop settings |
| `⌘⇧R` | Reset develop settings |
| `⌘⇧E` | Export JPEG (to `_Exports/`, or downloads for read-only folders) |
| `⌘Z` / `⇧⌘Z` | Undo, redo |
| `T T` | Toggle light/dark theme (a chord) |
| `⌘A` | Select all |

## RAW files

Camera RAW files (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2, PEF and [more](src/core/library/formats.ts)) are decoded in the browser by [LibRaw](https://www.libraw.org/) compiled to WebAssembly ([libraw-wasm](https://github.com/ybouane/LibRaw-Wasm)):

- **Grid and Loupe** show the camera's embedded JPEG preview, which is fast. Loupe uses it when it is at least 1600px; otherwise the sensor data is decoded. So 100% zoom on a RAW shows the embedded preview's resolution.
- **Develop and Export** demosaic the sensor data: AHD, camera white balance, sRGB, rotated upright. Develop decodes at half size when that still covers the screen.
- **RAW+JPEG pairs** with the same name are one photo, as in Lightroom: the RAW is listed (with a "RAW+JPG" chip on its card and "+JPG" in the info overlay), thumbnails and Loupe show the camera's JPEG, Develop and export work from the RAW, and the JPEG moves with it to and from `_Rejected/`. The **RAW+JPG** button in the filter bar (or `Shift+J`) splits them into separate photos that are rated and removed on their own, and groups them again; the choice is remembered.

LibRaw's WebAssembly uses threads, so the page must be **cross-origin isolated**: served over HTTPS (or on localhost) with these headers on **every** response, including `304 Not Modified` and static files (a `vite.config.ts` plugin does this for the dev and preview servers):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without them, RAW files are listed and can be rated, but show no image; Loupe and the thumbnail's tooltip say what is missing, and the console warns once. The headers also block cross-origin images and scripts that don't opt in with CORS or `Cross-Origin-Resource-Policy`.

From the devtools console: `await photo.dispatch("library.rating.set", { rating: 5 })`, or `photo.manifest()`.

## Docs

- [Architecture](docs/architecture.md)
- [Adding an action](docs/adding-an-action.md)
- [The action manifest](docs/manifest.md)
- [Generated operating guide](generated/SKILL.md)
