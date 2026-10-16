# Photo

A browser-based photo culling and editing app, in the spirit of Lightroom. Everything is an action in a central registry. Buttons, keyboard shortcuts, the command palette, scripts and (soon) an AI all dispatch the same actions.

**Status:** Phase 3 (develop). You can open a real folder (File System Access API in Chromium, read-only fallback elsewhere) or the sample library, cull, edit non-destructively on the GPU, and export JPEGs. AI comes in Phase 4.

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
| `⌘K` / `Ctrl+K` | Command palette (type `?` to ask AI, stubbed for now) |
| `⌘/` / `Ctrl+/` | Keyboard Shortcuts: search, rebind, resolve conflicts, import/export |
| `G` `E` `D` | Grid, Loupe and Develop views |
| `←` `→` `Home` `End` | Previous, next, first and last photo |
| `⌘O` / `Ctrl+O` | Open folder |
| `0`–`5` | Set rating |
| `P` `X` `U` | Pick, reject, unflag |
| `6`–`9` | Toggle red, yellow, green, blue label |
| Caps Lock | Auto-advance after rating/flagging (configurable: "Set Auto-Advance" in the palette) |
| `Shift+F10`, right-click | Photo context menu |
| `Z`, `I`, `F6` | Loupe zoom, info overlay, filmstrip |
| `⌘L` / `Ctrl+L` | Clear filter |
| `⌘⌫` / `Ctrl+Backspace` | Remove rejected photos (moved to `_Rejected/`; restore or delete them from the filter bar) |
| `\` | Before/after (Develop only) |
| `R` | Crop & straighten tool (Develop) |
| `⌘⇧C` / `⌘⇧V` / `⌘⇧S` | Copy / paste / sync develop settings |
| `⌘⇧R` | Reset develop settings |
| `⌘⇧E` | Export JPEG (to `_Exports/`, or downloads for read-only folders) |
| `⌘Z` / `⇧⌘Z` | Undo, redo |
| `T T` | Toggle light/dark theme (a chord) |
| `⌘A` | Select all |

From the devtools console: `await photo.dispatch("library.rating.set", { rating: 5 })`, or `photo.manifest()`.

## Docs

- [Architecture](docs/architecture.md)
- [Adding an action](docs/adding-an-action.md)
- [The action manifest](docs/manifest.md)
- [Generated operating guide](generated/SKILL.md)
