# Photon

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
| `R` | Crop & straighten tool (Loupe or Develop): drag outside the crop to rotate, ⌘/Ctrl-drag along a horizon to level it, hold Shift while resizing to keep the aspect ratio |
| `⌘⇧C` / `⌘⇧V` / `⌘⇧S` | Copy / paste / sync develop settings |
| `⌘⇧R` | Reset develop settings |
| `⌘⇧E` | Export the selected photos as JPEGs (select several in the Grid, or `⌘A` for all; to `_Exports/`, or downloads for read-only folders). Also in the photo menu and the top bar; the status bar shows progress with a Cancel button |
| `⌘Z` / `⇧⌘Z` | Undo, redo |
| `T T` | Toggle light/dark theme (a chord) |
| `⌘A` | Select all |

## Phones and tablets

The same app, reshaped for a small screen and for fingers (no keyboard needed):

- **Bottom bar** (narrow windows): Grid, Loupe and Develop, a **Filter** sheet with every filter and sort control (and the thumbnail size), and **Photo**, which opens the photo menu. The **⋯** button at the top right holds the rest: AI, undo/redo, info overlay, filmstrip, theme, shortcuts, account.
- **Rating bar** (touch screens): stars, pick/reject, colour labels and an auto-advance toggle for the selected photos, so culling works without the number and letter keys. Tapping the current value clears it.
- **Gestures**: tap a photo to select it and tap it again to open it in Loupe; long-press a photo (or the big photo) for its menu; swipe left or right in Loupe or Develop for the next or previous photo (at 100% zoom the swipe pans instead); tap the photo to toggle 100%.
- **Develop** stacks the controls under the photo in a sheet: drag its top edge to resize it, or collapse it with the chevron. Crop & Straighten works with a finger too.
- Menus open as sheets along the bottom edge; submenus drill in with a Back row.

The narrow layout starts at 720px wide; the touch affordances follow the device (`hover: none` and `pointer: coarse`), so a tablet with a mouse keeps the desktop layout and a tablet without one gets the rating bar. The `mobile` project in `playwright.config.ts` runs the phone tests (`yarn e2e --project mobile`).

## Accounts

Photon asks people to sign in before the app loads, using [Supabase Auth](https://supabase.com/docs/guides/auth) with no passwords:

- **Passkey**: Face ID, Touch ID, Windows Hello, a password manager or a security key. Photon offers to add one after the first email or phone sign-in, and from the account menu (top right) or the palette ("Add a Passkey").
- **Email**: a magic link. Open it in the same browser it was requested from (PKCE flow).
- **Phone**: a 6-digit code by text message. This needs an SMS provider (Twilio, MessageBird, Vonage or Textlocal) set up in Supabase.

The first sign-in creates the account. Photos, edits and settings still stay on the device; the account only signs you in.

**Setup.** Create `.env.local` (git-ignored) with the project's URL and publishable key (Dashboard → Project Settings → API):

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

[`supabase/config.toml`](supabase/config.toml) holds the auth settings (redirect URLs, email template, passkeys, SMS). Use it with the local stack (`supabase start`, which catches emails at http://localhost:54324) or push it to the hosted project (`supabase link`, then `supabase config push`). Before going live:

- set `site_url`, `additional_redirect_urls` and the `[auth.webauthn]` relying party to the production domain. Passkeys are bound to `rp_id`, so changing it later makes existing passkeys stop working;
- enable `[auth.sms]` plus one SMS provider to turn on phone sign-in;
- set up custom SMTP: Supabase's built-in email sender only allows a few emails an hour.

Without a URL and key, the dev server skips sign-in (with a console warning) and a production build shows a "Sign-in isn't set up" screen. `VITE_AUTH=off` turns sign-in off; the e2e tests use it.

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
