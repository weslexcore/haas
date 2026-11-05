# Photon: operating guide

> Generated from the action registry by `scripts/generate-manifest.ts`. Do not edit by hand.
> The machine-readable version is `actions.json`.

## What this app is

A browser-based photo culling and editing app, in the spirit of Lightroom. Users open a folder of photos, cull them (rate, flag, colour-label), make non-destructive edits, and export. Every operation is an action in a central registry; the keyboard, menus, command palette and AI all dispatch the same actions.

## How to operate it

- Every operation is an action, invoked by id with a JSON params object validated against the action's schema.
- Read state with query actions (kind: query) before proposing changes; they have no side effects.
- Respect each action's availability: dispatching an unavailable action fails.
- Commands marked undoable are recorded in history. A plan of several steps is applied as one transaction, so one undo reverts it.
- Library commands with an optional photoIds parameter act on the current selection when it is omitted.
- Shortcut keys use `mod` for Cmd on macOS and Ctrl elsewhere; chords are space-separated strokes.
- Photo ids are paths relative to the open folder, e.g. "2026-09/DSC_0001.jpg". Capture times are camera-local, formatted YYYY-MM-DDTHH:mm:ss without a time zone.
- Culling commands accept advance: true to move to the next photo afterwards; when called by an AI or script they never auto-advance otherwise.

## Concepts

**Library.** The set of photos currently loaded, in display order. Each photo has an id, file name, capture time, rating, flag and colour label. Image file contents are never modified.

**Selection.** One or more selected photos, plus one active photo (the one shown in Loupe and Develop). Library commands that accept an optional `photoIds` parameter act on the selection when it is omitted.

**Ratings.** An integer from 0 (unrated) to 5 stars.

**Flags.** `pick`, `reject` or `none` (unflagged). Rejects are typically hidden or deleted later.

**Colour labels.** `red`, `yellow`, `green`, `blue`, `purple` or `none`, used for ad-hoc grouping.

**Filter and sort.** The on-screen library can be filtered (minimum rating, flags, labels, file name) and sorted. Navigation and Select All follow what is visible. Query actions can filter independently of the screen.

**Auto-advance.** After a rating, flag or label command on a single photo, the app can move to the next photo: only while Caps Lock is on (default, as in Lightroom), always, or never. AI and scripts pass advance: true instead.

**Folders and sidecars.** The library is one folder (with subfolders). Ratings, flags and labels are stored in the app and, when the folder was opened with write access, in XMP sidecars next to the photos so Lightroom, Bridge and darktable can read them. The contents of photos are never modified.

**RAW files.** Camera RAW files (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2 and others; mimeType image/x-…) are photos like any other: rated, edited and exported the same way. While RAW+JPEG grouping is on (the default; see library.pairs.set), a RAW and a JPEG with the same name are one photo: the RAW is listed and the JPEG is hidden and moves with it when it is removed. When it is off, they are two separate photos.

**Seeing photos.** Metadata (rating, flags, EXIF, capture time) comes from query actions. To judge what is in a photo (sharpness, faces, subject, colour, how an edit looks), view it with library.photos.view, which returns images with the current edits applied. Viewing costs tokens: scan with thumbnails, check focus with detail.

**Removing photos.** Rejected photos can be removed from the library: they move, with their sidecars, into a _Rejected subfolder of the open folder and can be restored from there. Only emptying that folder deletes files, permanently (not to the system Trash), and it needs the user's explicit confirmation.

**Views.** `grid` shows thumbnails for fast scanning, `loupe` shows the active photo large for close review, and `develop` shows the active photo with editing controls.

**Edit recipes.** Non-destructive develop settings stored per photo as JSON: white balance (temperature, tint), exposure, contrast, highlights, shadows, whites, blacks, vibrance, saturation, a post-crop vignette, a tone curve, HSL per colour band, and crop/straighten, plus an optional profile. Rendered on the GPU; saved with the ratings and in the XMP sidecar. Exports apply them at full resolution. A photo with default settings is unedited.

**Profiles.** A profile is a film look applied under the sliders (as in Lightroom): colour or black and white, per-channel curves, split toning, fade and grain, with an amount (0–200%). Applying one keeps the sliders. There are built-in profiles (ids `builtin.…`) and the user's own (`user.…`), which can be created, edited, deleted, and exported to or imported from JSON files. A photo's edit holds a copy of its profile's look, so it renders the same where that profile isn't installed.

**Auto.** `develop.auto` sets tone (exposure, contrast, highlights, shadows, whites, blacks, vibrance) and/or white balance from each photo's own pixels, inside its crop, accounting for its profile. Each photo is analysed separately, so a batch gets individual settings in one undo step.

**Undo and transactions.** Undoable commands are recorded in history. A transaction groups several commands into one undo step; AI-proposed plans are always applied as a single transaction after the user reviews them.

## Workflows

### Reject the blurry frames in a burst

Keep the sharpest of several near-identical photos.

1. `library.photos.list` `{"capturedAfter":"2026-09-12T06:30","capturedBefore":"2026-09-12T06:35"}`: Find the burst by capture time.
2. `library.photos.view` `{"photoIds":["DSC_0001.jpg","DSC_0002.jpg","DSC_0003.jpg"],"size":"thumbnail"}`: Compare them; use detail size on the best candidates to check focus.
3. `library.flag.set` `{"flag":"reject","photoIds":["DSC_0001.jpg","DSC_0003.jpg"]}`: Reject the softer frames.
4. `library.flag.set` `{"flag":"pick","photoIds":["DSC_0002.jpg"]}`: Pick the sharpest.

### Give the selected photos a warm film look

Warm, slightly faded, less saturated, as one undoable step.

1. `develop.settings.apply` `{"settings":{"temperature":20,"contrast":-10,"saturation":-20,"toneCurve":[[0,0.06],[0.5,0.52],[1,0.94]]}}`: Applies to every selected photo.

### Give a set of photos a consistent look

Apply one film profile to the selection, then correct each photo's exposure and white balance individually.

1. `develop.profiles.list`: Choose a profile by its description (or the user's own).
2. `develop.profile.set` `{"profileId":"builtin.warm-portrait"}`: Apply it to every selected photo.
3. `develop.auto` `{"include":["wb","tone"]}`: Then Auto, so each photo is corrected under the profile.

### Make a reusable profile

Save a look as one of the user's own profiles and apply it.

1. `develop.profiles.create` `{"name":"Moody Teal","from":"builtin.cool-cinema","look":{"fade":10,"grain":{"amount":20}}}`: Start from a built-in look and change some fields; returns the new id.
2. `develop.profile.set` `{"profileId":"user.moody-teal"}`: Apply it with the returned id.
3. `develop.profiles.export` `{"ids":["user.moody-teal"]}`: Optionally save it to a file to share.

### Edit one photo, then match the rest

Develop the active photo and copy its look to the other selected photos.

1. `develop.adjust` `{"setting":"exposure","value":0.5}`: Adjust the active photo (select just it first).
2. `library.selection.all`: Select the photos to match.
3. `develop.settings.sync`: Copies everything except crop from the active photo.

### Cull a shoot

Go through every photo once, picking keepers and rejecting the rest.

1. `app.context.get`: Check what is loaded and which photo is active.
2. `view.set` `{"view":"loupe"}`: Review one photo at a time at a large size.
3. `library.flag.set` `{"flag":"pick","advance":true}`: Pick the active photo and move on…
4. `library.flag.set` `{"flag":"reject","advance":true}`: …or reject it and move on.
5. `library.filter.set` `{"flags":["pick"]}`: Afterwards, show only the picks.

### Rate a batch of selected photos

Give the current selection the same star rating in one undoable step.

1. `library.selection.get`: Confirm which photos are selected.
2. `library.rating.set` `{"rating":3}`: Rate them all; omit photoIds to use the selection.

### Show only the best photos

Find the photos rated 4 stars or more.

1. `library.photos.list` `{"minRating":4}`: Find them (ids, names, metadata).
2. `library.filter.set` `{"minRating":4}`: Or show only them on screen.

### Show this morning's best photos

Find 4+ star photos captured before noon on a given day.

1. `app.context.get`: Check the folder and the capture dates in view.
2. `library.photos.list` `{"minRating":4,"capturedAfter":"2026-09-12T00:00","capturedBefore":"2026-09-12T12:00"}`: Capture times are camera-local.
3. `library.selection.set` `{"ids":["DSC_0003.jpg","DSC_0007.jpg"]}`: Select the matches by id.

### Warm up and brighten the selection

Apply a warmer white balance and a little more exposure to every selected photo.

1. `library.selection.get`: Check which photos are selected.
2. `develop.adjust` `{"setting":"temperature","delta":15}`: Shift white balance warmer, relative to each photo.
3. `develop.adjust` `{"setting":"exposure","delta":0.3}`: Raise exposure by a third of a stop.

## Actions

### App

#### Add a Passkey: `app.account.passkey.add`

Command

Register a passkey (Face ID, Touch ID, Windows Hello, a password manager or a security key) for the signed-in account, so the user can sign in on this device without an email link or text code.

*Available only when the user is signed in to a Photon account.*

#### Sign Out: `app.account.signOut`

Command

Sign out of the Photon account. Pending rating, flag and label changes are saved first; the app then returns to the sign-in screen. Photos and edits stay on this device.

*Available only when the user is signed in to a Photon account.*

#### List Actions: `app.actions.list`

Query (no side effects)

Return every registered action's id, title, category, kind and whether it is available right now. Use availableOnly to see only what can run in the current context.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `category` | `"App"` \| `"View"` \| `"Navigation"` \| `"Library"` \| `"Develop"` \| `"History"` | no | Only this category. |
| `availableOnly` | boolean | no | Only actions available in the current context. |

Examples:

- `{}`: List all actions.
- `{"category":"Library","availableOnly":true}`: Library actions usable right now.

#### Toggle AI Panel: `app.ai.panel.toggle`

Command · Shortcuts: `mod+j`

Show or hide the AI conversation panel, which keeps every suggestion and what was applied.

*Always available.*

#### Close AI Settings: `app.ai.settings.close`

Command

Close the AI settings screen.

*Available only when AI settings are open.*

#### AI Settings…: `app.ai.settings.open`

Command

Open AI settings: the Anthropic API key (stored only in this browser) and which Claude model plans requests.

*Always available.*

#### New AI Conversation: `app.ai.thread.clear`

Command

Start a new AI conversation for this folder. The previous conversation and its suggestions are discarded.

*Available only when there is an AI conversation.*

#### Set Auto-Advance: `app.autoAdvance.set`

Command

Choose when rating, flagging or labelling a photo moves on to the next one: capsLock (only while Caps Lock is on, as in Lightroom; the default), always, or never. Applies to keyboard, palette, menu and button use; AI and scripts advance only when they pass advance: true. The choice is remembered.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `mode` | `"capsLock"` \| `"always"` \| `"never"` | yes | When to auto-advance. |

Examples:

- `{"mode":"always"}`: Always move to the next photo after culling.
- `{"mode":"capsLock"}`: Lightroom behaviour: only while Caps Lock is on.

#### Get App Context: `app.context.get`

Query (no side effects)

Return a summary of the current app state: view, theme, library size, selection, active photo and undo/redo availability. Call this first to understand what the user is looking at.

*Always available.*

#### Close Context Menu: `app.contextMenu.close`

Command

Close the open context menu without running anything.

*Available only when a context menu is open.*

#### Open Context Menu: `app.contextMenu.open`

Command · Shortcuts: `shift+f10`, `contextmenu`

Open a context menu. Without menuId, opens the photo menu for the current view next to the active photo (the keyboard equivalent of right-clicking it); that needs photos in the library. x/y place it at a viewport position; on small screens menus open as a sheet at the bottom instead.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `menuId` | string | no | Menu to open; defaults to the current view's photo menu. |
| `x` | number | no | Viewport x position in CSS pixels. |
| `y` | number | no | Viewport y position in CSS pixels. |

Examples:

- `{}`: Open the photo menu for the active photo.
- `{"menuId":"grid.photo","x":320,"y":240}`: Open the grid photo menu at a point.

#### Export Action Manifest: `app.manifest.export`

Command

Download the action manifest generated from the live registry: actions.json (machine-readable, with JSON Schemas) or SKILL.md (a readable guide for people and AI agents).

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `format` | `"json"` \| `"skill"`, default `"json"` | no | json for actions.json, skill for SKILL.md. |

Examples:

- `{"format":"json"}`: Download actions.json.
- `{"format":"skill"}`: Download SKILL.md.

#### Close Command Palette: `app.palette.close`

Command

Close the command palette without running anything.

*Available only when the command palette is open.*

#### Toggle Command Palette: `app.palette.open`

Command · Shortcuts: `mod+k`

Open the command palette, a searchable list of every available action. Pass actionId to open it directly on that action's parameter form. Running it while the palette is open (with no actionId) closes it.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `actionId` | string | no | Open straight to this action's parameter step. |

Examples:

- `{}`: Open the palette to search all actions.
- `{"actionId":"library.rating.set"}`: Ask the user which rating to apply.

#### Assign Shortcut: `app.shortcuts.bind`

Command

Bind a key combo to an action, optionally with fixed params. Adds a new binding, or replaces the keys of binding number `replaceIndex`. Keys use `mod` for Cmd/Ctrl and spaces for chords. Saved as a user override.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `actionId` | string | yes | The action to bind. |
| `keys` | string | yes | Key combo, e.g. "mod+shift+e" or "g d" (a chord). |
| `params` | any | no | Fixed params to dispatch with this binding. |
| `replaceIndex` | integer (0–9007199254740991) | no | Replace the keys of this existing binding instead of adding one. |

Examples:

- `{"actionId":"view.set","keys":"shift+g","params":{"view":"grid"}}`: Also open the grid with Shift+G.
- `{"actionId":"history.redo","keys":"mod+y","replaceIndex":0}`: Use Mod+Y for redo instead of the default.

#### Close Keyboard Shortcuts: `app.shortcuts.close`

Command

Close the Keyboard Shortcuts screen.

*Available only when the Keyboard Shortcuts screen is open.*

#### Export Shortcuts: `app.shortcuts.export`

Command

Download the user's custom shortcut overrides as a JSON file that can be imported elsewhere.

*Always available.*

#### Import Shortcuts: `app.shortcuts.import`

Command

Replace all custom shortcut overrides with ones from an exported JSON document. Bindings for actions that no longer exist are skipped.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `json` | string | yes | Contents of a file made by Export Shortcuts. |

Examples:

- `{"json":"{\"version\":1,\"overrides\":{\"history.redo\":[{\"keys\":\"mod+y\"}]}}"}`: Import a single override.

#### Keyboard Shortcuts: `app.shortcuts.open`

Command · Shortcuts: `mod+/`

Open the Keyboard Shortcuts screen, where the user can search actions, rebind keys, resolve conflicts, reset to defaults and import or export bindings as JSON.

*Always available.*

#### Reset Shortcuts: `app.shortcuts.reset`

Command

Restore default shortcuts for one action, or for every action when actionId is omitted.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `actionId` | string | no | Reset only this action. Omit to reset all shortcuts. |

Examples:

- `{"actionId":"view.set"}`: Restore G/E/D for the views.
- `{}`: Reset every shortcut to its default.

#### Remove Shortcut: `app.shortcuts.unbind`

Command

Remove binding number `index` from an action's shortcut list (see the shortcut list for indexes).

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `actionId` | string | yes | The action whose binding to remove. |
| `index` | integer (0–9007199254740991) | yes | Position of the binding in the action's list, starting at 0. |

Examples:

- `{"actionId":"app.theme.toggle","index":0}`: Remove the theme toggle's chord.

#### Set Theme: `app.theme.set`

Command

Choose the colour theme: light, dark, or follow the operating system setting. The choice is remembered.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `theme` | `"light"` \| `"dark"` \| `"system"` | yes | Colour theme to use. |

Examples:

- `{"theme":"dark"}`: Use the dark theme.
- `{"theme":"system"}`: Follow the OS light/dark setting.

#### Toggle Light/Dark Theme: `app.theme.toggle`

Command · Shortcuts: `t t`

Switch between the light and dark themes, starting from whichever one is currently showing.

*Always available.*

### View

#### Toggle Before/After: `view.beforeAfter.toggle`

Command · Shortcuts: `\`

In Develop, switch between showing the edited photo and the original, to compare the effect of edits.

*Available only when the current view is Develop.*

#### Resize Filmstrip: `view.filmstrip.resize`

Command

Set the height of the filmstrip below the photo in Loupe and Develop, in pixels (56–360). Omit the height to restore the default.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `height` | number | no | Filmstrip height in px. Omit for the default height. |

Examples:

- `{"height":160}`: Show bigger filmstrip thumbnails.
- `undefined`: Restore the default filmstrip height.

#### Toggle Filmstrip: `view.filmstrip.toggle`

Command · Shortcuts: `f6`

Show or hide the strip of thumbnails below the photo in Loupe and Develop.

*Always available.*

#### Set Grid Thumbnail Size: `view.grid.size.set`

Command

Set how big the thumbnails in Grid are: the target cell width in pixels (96–480); the grid fits as many columns of that width as it can. Omit the width to restore the default. The choice is remembered.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `width` | number | no | Thumbnail cell width in px. Omit for the default size. |

Examples:

- `{"width":320}`: Big thumbnails, a few per row.
- `{"width":96}`: Tiny thumbnails, many per row.
- `undefined`: Restore the default thumbnail size.

#### Grid Thumbnails Larger / Smaller: `view.grid.size.step`

Command · Shortcuts: `=` → `{"direction":"larger"}`, `-` → `{"direction":"smaller"}`

Make the Grid thumbnails one step (24px) larger or smaller. Stops at the limits (96–480px).

*Available only when the current view is Grid.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `direction` | `"larger"` \| `"smaller"` | yes | Which way to step. |

Examples:

- `{"direction":"larger"}`: Bigger thumbnails.

#### Toggle Info Overlay: `view.info.toggle`

Command · Shortcuts: `i`

Show or hide capture details (camera, lens, exposure, time) over the photo in Loupe and Develop.

*Available only when the current view is Loupe or Develop.*

#### Dock Develop Panel: `view.panel.dock`

Command

Attach the floating Develop controls panel back to a window edge: the given side, or the side it was last docked to.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `side` | `"left"` \| `"right"` | no | Edge to dock to. Omit to use the previous side. |

Examples:

- `undefined`: Dock the panel where it was.
- `{"side":"left"}`: Dock the panel on the left.

#### Dock / Undock Develop Panel: `view.panel.dock.toggle`

Command · Shortcuts: `f7`

Float the Develop controls panel if it is docked, or dock it back to its side if it is floating.

*Always available.*

#### Resize Develop Panel: `view.panel.resize`

Command

Set the width of the docked Develop controls panel in pixels (220–640). Omit the width to restore the default.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `width` | number | no | Panel width in px. Omit for the default width. |

Examples:

- `{"width":380}`: Make the panel 380px wide.
- `undefined`: Restore the default panel width.

#### Move Develop Panel to Side: `view.panel.side.set`

Command

Dock the Develop controls panel to the left or right edge of the window. If the panel is floating, this docks it. The choice is remembered.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `side` | `"left"` \| `"right"` | yes | Window edge to dock the panel to. |

Examples:

- `{"side":"left"}`: Put the Develop panel on the left.

#### Move Develop Panel to Other Side: `view.panel.side.toggle`

Command · Shortcuts: `shift+f7`

Swap the Develop controls panel between the left and right edges of the window (docking it first if it is floating).

*Always available.*

#### Undock Develop Panel: `view.panel.undock`

Command

Detach the Develop controls panel so it floats over the photo and can be dragged anywhere. Optionally say where to put it (viewport pixels). Dock it again with view.panel.dock.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `x` | number | no | Left edge of the floating panel, px from the window's left. |
| `y` | number | no | Top edge of the floating panel, px from the window's top. |

Examples:

- `undefined`: Float the panel where it last floated.
- `{"x":40,"y":80}`: Float the panel near the top-left corner.

#### Switch View: `view.set`

Command · Shortcuts: `g` → `{"view":"grid"}`, `e` → `{"view":"loupe"}`, `d` → `{"view":"develop"}`

Switch the main view: grid (thumbnails for scanning and multi-select), loupe (the active photo, large, for close review), or develop (the active photo with editing controls).

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `view` | `"grid"` \| `"loupe"` \| `"develop"` | yes | The view to show. |

Examples:

- `{"view":"grid"}`: Show the thumbnail grid.
- `{"view":"loupe"}`: Review the active photo at a large size.

#### Toggle Zoom: `view.zoom.toggle`

Command · Shortcuts: `z`

In Loupe, switch between fitting the whole photo in the window and 100% (actual pixels) to check focus.

*Available only when the current view is Loupe and a photo is active.*

### Navigation

#### First Photo: `navigation.first`

Command · Shortcuts: `home`

Make the first visible photo active and select only it.

*Available only when the library contains photos.*

#### Last Photo: `navigation.last`

Command · Shortcuts: `end`

Make the last visible photo active and select only it.

*Available only when the library contains photos.*

#### Next Photo: `navigation.next`

Command · Shortcuts: `right`

Make the next visible photo active and select only it. Stays on the last photo at the end.

*Available only when the library contains photos.*

#### Previous Photo: `navigation.previous`

Command · Shortcuts: `left`

Make the previous visible photo active and select only it. Stays on the first photo at the start.

*Available only when the library contains photos.*

### Library

#### Set Color Label: `library.colorLabel.set`

Command, undoable

Apply a colour label to the selected photos (or specific photos by id). Use none to remove it.

*Available only when at least one photo is selected.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `label` | `"none"` \| `"red"` \| `"yellow"` \| `"green"` \| `"blue"` \| `"purple"` | yes | Colour label, or none. |
| `photoIds` | string[] | no | Photos to change (their ids are relative paths). Omit to use the current selection. |
| `advance` | boolean | no | Move to the next photo afterwards. When omitted, follows the auto-advance setting for interactive use; AI and scripts never advance unless this is true. |

Examples:

- `{"label":"red"}`: Label the selection red.
- `{"label":"none","photoIds":["DSC_0002.jpg"]}`: Remove the label from one photo.

#### Toggle Color Label: `library.colorLabel.toggle`

Command, undoable · Shortcuts: `6` → `{"label":"red"}`, `7` → `{"label":"yellow"}`, `8` → `{"label":"green"}`, `9` → `{"label":"blue"}`

Lightroom-style label key: apply the label to the selected photos, or remove it if the active photo already has that label.

*Available only when at least one photo is selected.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `label` | `"none"` \| `"red"` \| `"yellow"` \| `"green"` \| `"blue"` \| `"purple"` | yes | Colour label to toggle. |
| `advance` | boolean | no | Move to the next photo afterwards. When omitted, follows the auto-advance setting for interactive use; AI and scripts never advance unless this is true. |

Examples:

- `{"label":"red"}`: Toggle red on the selection.

#### Clear Filter: `library.filter.clear`

Command · Shortcuts: `mod+l`

Remove every filter (rating, flags, labels, text) so all photos in the folder are shown again.

*Always available.*

#### Filter Photos: `library.filter.set`

Command

Change which photos are shown. Given fields replace the current ones; omitted fields keep their value. Flags and colour labels match any of the listed values; an empty list means any.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `minRating` | integer (0–5) | no | Show photos rated at least this; 0 for any. |
| `flags` | `"pick"` \| `"reject"` \| `"none"`[] | no | Show only these flags; [] for any. |
| `colorLabels` | `"none"` \| `"red"` \| `"yellow"` \| `"green"` \| `"blue"` \| `"purple"`[] | no | Show only these labels; [] for any. |
| `text` | string | no | Show only paths containing this text; empty for any. |

Examples:

- `{"minRating":4}`: Show 4+ star photos.
- `{"flags":["pick"]}`: Show picks only.
- `{"flags":["pick","none"]}`: Hide rejects.

#### Set Flag: `library.flag.set`

Command, undoable · Shortcuts: `p` → `{"flag":"pick"}`, `x` → `{"flag":"reject"}`, `u` → `{"flag":"none"}`

Flag the selected photos (or specific photos by id) as pick, reject, or none to clear the flag.

*Available only when at least one photo is selected.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `flag` | `"pick"` \| `"reject"` \| `"none"` | yes | pick keeps, reject discards, none clears. |
| `photoIds` | string[] | no | Photos to change (their ids are relative paths). Omit to use the current selection. |
| `advance` | boolean | no | Move to the next photo afterwards. When omitted, follows the auto-advance setting for interactive use; AI and scripts never advance unless this is true. |

Examples:

- `{"flag":"pick"}`: Pick the selected photos.
- `{"flag":"reject","photoIds":["DSC_0007.jpg","DSC_0008.jpg"]}`: Reject two specific photos.

#### Open Folder…: `library.folder.open`

Command · Shortcuts: `mod+o`

Ask the user to choose a folder of photos and load it, replacing the current library. Subfolders are included. Ratings, flags and labels are restored from app storage and XMP sidecars.

*Always available.*

#### Open Recent Folder: `library.folder.openRecent`

Command

Reopen a previously used folder by id (see library.folders.recent). May ask the user for permission.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `folderId` | string | yes | Folder id from library.folders.recent. |

Examples:

- `{"folderId":"3f2a9c1e"}`: Reopen a remembered folder.

#### Reconnect Folder: `library.folder.reconnect`

Command

Grant the browser permission to read the last-used folder again and reload it. Needed after a restart when the browser asks for permission again.

*Available only when the last folder needs permission to be reopened.*

#### List Recent Folders: `library.folders.recent`

Query (no side effects)

Return remembered folders (id, name, kind, whether sidecars can be written), most recent first.

*Always available.*

#### Set RAW+JPEG Grouping: `library.pairs.set`

Command

Choose how a RAW and a JPEG with the same name are treated. Grouped (the default, as in Lightroom): they are one photo; the RAW is listed, marked +JPG, and the JPEG moves with it when it is removed. Separate: they are two photos, rated and removed independently. The choice is remembered.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `grouped` | boolean | yes | true to group each pair as one photo; false to list the RAW and the JPEG separately. |

Examples:

- `{"grouped":false}`: List RAW and JPEG files separately.
- `{"grouped":true}`: Treat each RAW+JPEG pair as one photo.

#### Toggle RAW+JPEG Grouping: `library.pairs.toggle`

Command · Shortcuts: `shift+j`

Switch between showing each RAW+JPEG pair as one photo (the JPEG hidden, removed with the RAW) and as two separate photos.

*Always available.*

#### List Photos: `library.photos.list`

Query (no side effects)

Return photos in display order with their metadata, filtered by any combination of rating range, flags, colour labels, capture-time range (camera local time) and path text. Independent of the on-screen filter unless onlyVisible is true. Use it to find photos before acting on them by id.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `minRating` | integer (0–5) | no | Only photos rated at least this. |
| `maxRating` | integer (0–5) | no | Only photos rated at most this. |
| `flags` | `"pick"` \| `"reject"` \| `"none"`[] | no | Only photos with one of these flags. |
| `colorLabels` | `"none"` \| `"red"` \| `"yellow"` \| `"green"` \| `"blue"` \| `"purple"`[] | no | Only photos with one of these labels. |
| `capturedAfter` | string | no | Only photos captured at or after this local time. |
| `capturedBefore` | string | no | Only photos captured before this local time. |
| `text` | string | no | Only photos whose path contains this text (case-insensitive). |
| `onlyVisible` | boolean | no | Start from the photos the on-screen filter shows. |
| `limit` | integer (1–10000) | no | Return at most this many photos. |

Examples:

- `{"minRating":4}`: Photos rated 4 or 5 stars.
- `{"flags":["reject"]}`: All rejected photos.
- `{"minRating":4,"capturedAfter":"2026-09-12T05:00","capturedBefore":"2026-09-12T12:00"}`: 4+ star photos from the morning of 12 September.

#### View Photos: `library.photos.view`

Query (no side effects)

Look at photos as images (for the AI): returns JPEGs of the given photos, with their current develop edits applied unless original is true. Use thumbnail size to scan many photos (duplicates, obvious blur, subjects), preview to judge a look or colour, detail to check focus. Viewing costs tokens: look only at what the request needs. At most 24 thumbnails, 8 previews or 3 detail images per call.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `photoIds` | string[] | yes | Photos to look at (ids from library.photos.list or the selection). |
| `size` | `"thumbnail"` \| `"preview"` \| `"detail"` | no | thumbnail 512px, preview 1024px (default), detail 1568px. |
| `original` | boolean | no | Show the unedited photo instead of the current edit. |

Examples:

- `{"photoIds":["DSC_0001.jpg"],"size":"preview"}`: Look at one photo as currently edited.
- `{"photoIds":["DSC_0001.jpg","DSC_0002.jpg","DSC_0003.jpg"],"size":"thumbnail"}`: Compare a burst for the sharpest frame.

#### Set Rating: `library.rating.set`

Command, undoable · Shortcuts: `0` → `{"rating":0}`, `1` → `{"rating":1}`, `2` → `{"rating":2}`, `3` → `{"rating":3}`, `4` → `{"rating":4}`, `5` → `{"rating":5}`

Set the star rating (0 = unrated, 1–5 stars) on the selected photos, or on specific photos by id.

*Available only when at least one photo is selected.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `rating` | integer (0–5) | yes | Stars, 0–5. 0 clears the rating. |
| `photoIds` | string[] | no | Photos to change (their ids are relative paths). Omit to use the current selection. |
| `advance` | boolean | no | Move to the next photo afterwards. When omitted, follows the auto-advance setting for interactive use; AI and scripts never advance unless this is true. |

Examples:

- `{"rating":3}`: Give the selected photos 3 stars.
- `{"rating":0,"photoIds":["DSC_0004.jpg"]}`: Clear the rating of one specific photo.

#### Remove Rejected Photos: `library.rejected.remove`

Command, undoable · Shortcuts: `mod+backspace`

Move rejected photos (and their XMP sidecars) out of the library into the folder's _Rejected subfolder. Nothing is deleted: undo, or Restore Removed Photos, brings them back until that folder is emptied. Defaults to every rejected photo; photoIds limits it to some of them.

*Available only when the folder was opened with write access and at least one photo is flagged rejected.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `photoIds` | string[] | no | Only these rejected photos. Omit for all rejected photos. |

Examples:

- `{}`: Move every rejected photo to the _Rejected folder.
- `{"photoIds":["DSC_0007.jpg"]}`: Move one rejected photo.

#### Delete Removed Photos Permanently: `library.removed.empty`

Command

Permanently delete everything in the _Rejected subfolder. This cannot be undone and the files do not go to the system Trash, and it clears undo history. Requires confirm: true; always ask the user first.

*Available only when the folder was opened with write access and the folder's _Rejected subfolder contains removed photos.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `confirm` | boolean | yes | Must be true: confirms the user agreed to delete the files permanently. |

Examples:

- `{"confirm":true}`: After the user confirms, delete the removed photos for good.

#### List Removed Photos: `library.removed.list`

Query (no side effects)

Return photos in the _Rejected subfolder by their original path, with size and modified time.

*Always available.*

#### Restore Removed Photos: `library.removed.restore`

Command, undoable

Move photos back from the _Rejected subfolder to where they were, with their ratings and sidecars. Defaults to all of them. Undoable.

*Available only when the folder was opened with write access and the folder's _Rejected subfolder contains removed photos.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `photoIds` | string[] | no | Original paths to restore (see List Removed Photos). Omit for all. |

Examples:

- `{}`: Restore everything that was removed.
- `{"photoIds":["day2/IMG_0003.jpg"]}`: Restore one photo.

#### Open Sample Library: `library.sample.load`

Command

Load the built-in sample library of placeholder photos, for trying the app without real files.

*Always available.*

#### Select All: `library.selection.all`

Command · Shortcuts: `mod+a`

Select every photo that passes the current filter, keeping the active photo if it is visible.

*Available only when the library contains photos.*

#### Get Selection: `library.selection.get`

Query (no side effects)

Return the active photo id and the selected photos with their metadata (rating, flag, label, capture time, EXIF).

*Always available.*

#### Select Photos: `library.selection.set`

Command

Replace the selection with the given photos. activeId (default: the first id) becomes the active photo shown in Loupe and Develop.

*Available only when the library contains photos.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `ids` | string[] | yes | Photo ids to select, in order. |
| `activeId` | string | no | Which selected photo becomes active. Must be in ids. |

Examples:

- `{"ids":["DSC_0003.jpg"]}`: Select a single photo.
- `{"ids":["DSC_0001.jpg","DSC_0002.jpg","DSC_0003.jpg"],"activeId":"DSC_0002.jpg"}`: Select three, with the middle one active.

#### Sort Photos: `library.sort.set`

Command

Choose the display order: capture time, file name, rating or file size, ascending or descending.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `key` | `"capturedAt"` \| `"fileName"` \| `"rating"` \| `"size"` | yes | What to sort by. |
| `direction` | `"asc"` \| `"desc"`, default `"asc"` | no | asc: oldest/A/lowest first. |

Examples:

- `{"key":"capturedAt","direction":"asc"}`: Oldest first.
- `{"key":"rating","direction":"desc"}`: Best rated first.

### Develop

#### Adjust Setting: `develop.adjust`

Command, undoable

Set (value) or nudge (delta) one slider on the selected photos: temperature, tint, exposure (stops, -5 to 5), contrast, highlights, shadows, whites, blacks, vibrance, saturation or vignette (-100 to 100; negative vignette darkens the corners, positive lightens them). Use delta to change each photo relative to its current setting.

*Available only when at least one photo is selected.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `setting` | `"temperature"` \| `"tint"` \| `"exposure"` \| `"contrast"` \| `"highlights"` \| `"shadows"` \| `"whites"` \| `"blacks"` \| `"vibrance"` \| `"saturation"` \| `"vignette"` | yes | Which slider. |
| `value` | number | no | New value (clamped to the slider's range). |
| `delta` | number | no | Amount to add to the current value. |
| `photoIds` | string[] | no | Photos to change. Omit to use the current selection. |

Examples:

- `{"setting":"exposure","delta":0.3}`: Brighten the selection by a third of a stop.
- `{"setting":"temperature","value":25}`: Warm up the white balance.
- `{"setting":"contrast","value":0}`: Reset contrast.

#### Auto Tone: `develop.auto`

Command, undoable · Shortcuts: `mod+u`, `mod+shift+u` → `{"include":["wb"]}`

Automatically set the selected photos' tone (exposure, contrast, highlights, shadows, whites, blacks, vibrance) and/or white balance (temperature, tint) from each photo's own pixels, inside its crop. Each photo is analysed separately and the result accounts for its profile and other settings, so apply a profile first. Tone replaces those sliders; nothing else changes. One undo step for all photos.

*Available only when at least one photo is selected.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `include` | `"tone"` \| `"wb"`[] | no | What to set: tone, wb (white balance), or both. Defaults to tone. |
| `photoIds` | string[] | no | Photos to change. Omit to use the current selection. |

Examples:

- `{}`: Auto Tone on the selection.
- `{"include":["wb"]}`: Auto white balance only.
- `{"include":["wb","tone"]}`: Both, for a batch of photos straight off the card.

#### Straighten Along Line: `develop.crop.level`

Command, undoable

Straighten the active photo so a line along a horizon or vertical edge becomes level (horizontal, or vertical when the line is closer to vertical). from/to are fractions (0–1, y down) of the uncropped photo as currently straightened; with no straighten angle yet, that is the original photo. The crop is kept inside the rotated photo.

*Available only when a photo is active.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `from` | object | yes | One end of the line. |
| `to` | object | yes | The other end. |

Examples:

- `{"from":{"x":0.1,"y":0.52},"to":{"x":0.9,"y":0.48}}`: Level a horizon that rises to the right.

#### Crop & Straighten: `develop.crop.set`

Command, undoable

Set the crop rectangle (fractions of the straightened photo: x, y, width, height) and/or straighten angle (-45 to 45 degrees) on the selected photos. The crop is kept inside the rotated photo automatically. Use aspect to crop to a ratio, as large as fits.

*Available only when at least one photo is selected.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `x` | number (0–1) | no | Left edge, 0–1. |
| `y` | number (0–1) | no | Top edge, 0–1. |
| `width` | number (0.01–1) | no | Width, 0–1. |
| `height` | number (0.01–1) | no | Height, 0–1. |
| `angle` | number (-45–45) | no | Straighten angle in degrees, clockwise. |
| `aspect` | `"original"` \| `"1:1"` \| `"4:5"` \| `"5:4"` \| `"2:3"` \| `"3:2"` \| `"16:9"` \| `"9:16"` | no | Crop to this aspect ratio (width:height), centred and as large as fits. |
| `photoIds` | string[] | no | Photos to change. Omit to use the current selection. |

Examples:

- `{"aspect":"1:1"}`: Square crop.
- `{"angle":-2.5}`: Straighten a slightly tilted horizon.
- `{"x":0.1,"y":0.1,"width":0.8,"height":0.8}`: Trim 10% from every edge.

#### Crop Tool: `develop.cropTool.toggle`

Command · Shortcuts: `r`

Show or hide the crop & straighten overlay on the active photo in Loupe or Develop, where the crop can be moved, resized and rotated.

*Available only when the current view is Loupe or Develop and a photo is active.*

#### Export JPEG: `develop.export`

Command · Shortcuts: `mod+shift+e`

Render the selected photos with their edits at full resolution (or limited to maxEdge pixels on the long side) and save them as JPEGs: into the folder's _Exports subfolder when it is writable, otherwise as downloads. Originals are untouched; existing exports are never overwritten.

*Available only when at least one photo is selected.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `quality` | number (0.3–1) | no | JPEG quality, 0.3–1 (default 0.9). |
| `maxEdge` | integer (64–16384) | no | Longest side in pixels; omit for full size. |
| `destination` | `"folder"` \| `"download"` | no | folder (_Exports) or download; defaults to folder when writable. |
| `photoIds` | string[] | no | Photos to change. Omit to use the current selection. |

Examples:

- `{}`: Export the selection at full size.
- `{"maxEdge":2048,"quality":0.85}`: Smaller copies for sharing.

#### Set HSL: `develop.hsl.set`

Command, undoable

Adjust one colour band's hue, saturation or luminance (-100 to 100) on the selected photos. Bands: red, orange, yellow, green, aqua, blue, purple, magenta. E.g. lower blue luminance to darken a sky.

*Available only when at least one photo is selected.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `channel` | `"hue"` \| `"saturation"` \| `"luminance"` | yes | What to change. |
| `band` | `"red"` \| `"orange"` \| `"yellow"` \| `"green"` \| `"aqua"` \| `"blue"` \| `"purple"` \| `"magenta"` | yes | Which colour range. |
| `value` | number (-100–100) | yes | New value, -100 to 100. |
| `photoIds` | string[] | no | Photos to change. Omit to use the current selection. |

Examples:

- `{"channel":"luminance","band":"blue","value":-40}`: Darken blue skies.
- `{"channel":"saturation","band":"orange","value":-15}`: Calm down skin tones.

#### Straighten Tool: `develop.levelTool.toggle`

Command

Arm or disarm the straighten tool in Loupe or Develop: the next drag over the photo draws a line along a horizon or vertical edge, and the photo is rotated to make it level. Opens the crop overlay. (In the crop overlay, ⌘/Ctrl-drag does the same without arming it.)

*Available only when the current view is Loupe or Develop and a photo is active.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `on` | boolean | no | Arm (true) or disarm (false); omit to toggle. |

Examples:

- `{}`: Toggle the straighten tool.
- `{"on":false}`: Disarm it.

#### Set Profile: `develop.profile.set`

Command, undoable

Apply a profile (a film look under the sliders: colour or black and white, curves, toning, grain) to the selected photos, or "none" to remove it. The sliders are kept. amount is its strength in percent (0–200, default 100); amount alone changes the strength of each photo's current profile. Ids come from develop.profiles.list.

*Available only when at least one photo is selected.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `profileId` | string | no | Profile id from develop.profiles.list, or "none" to remove the profile. |
| `amount` | number (0–200) | no | Strength in percent, 0–200 (100 is the profile as designed). |
| `photoIds` | string[] | no | Photos to change. Omit to use the current selection. |

Examples:

- `{"profileId":"builtin.classic-bw"}`: Classic black and white.
- `{"profileId":"builtin.faded-print","amount":60}`: A lighter faded-print look.
- `{"amount":140}`: Strengthen each photo's current profile.
- `{"profileId":"none"}`: Remove the profile.

#### New Profile: `develop.profiles.create`

Command, undoable

Create one of the user's own profiles. It starts from another profile's look (from), else the active photo's current profile, else neutral; look then changes any fields. Returns the new id. Use develop.profile.set to apply it.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | Name shown in the profile browser. |
| `description` | string | no | What the look is like. |
| `from` | string | no | Copy this profile's look (id). |
| `look` | object | no | Look fields to change; anything omitted is kept. |

Examples:

- `{"name":"My Sepia","from":"builtin.sepia","look":{"fade":15}}`: A more faded copy of Sepia.
- `{"name":"Teal Shadows","look":{"splitToning":{"shadowHue":185,"shadowSaturation":35},"fade":5}}`: A new look from scratch.

#### Delete Profile: `develop.profiles.delete`

Command, undoable

Delete one of the user's own profiles. Photos that use it keep their look (each edit holds a copy of it). Undoable. Built-in profiles can't be deleted.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Profile id, from develop.profiles.list. |

Examples:

- `{"id":"user.my-sepia"}`: Delete a profile.

#### Export Profiles: `develop.profiles.export`

Command

Save profiles to a JSON file on the user's disk (a download) to back them up or share them; develop.profiles.import loads them back. Exports the given ids (built-in or the user's own), or all of the user's own profiles.

*Available only when there are profiles to export.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `ids` | string[] | no | Profiles to export. Omit for all of your own. |

Examples:

- `{}`: Export all of your profiles.
- `{"ids":["user.my-sepia"]}`: Export one profile to share.

#### Get Profile: `develop.profiles.get`

Query (no side effects)

Return one profile's full definition (name, description, look), built-in or the user's own.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Profile id, from develop.profiles.list. |

Examples:

- `{"id":"builtin.sepia"}`: The Sepia profile's settings.

#### Import Profiles: `develop.profiles.import`

Command, undoable

Add the profiles in a profiles file (the parsed JSON written by develop.profiles.export) to the user's own. A profile identical to an existing one is skipped; one whose id is already used is added as a copy with a new name, unless replace is true, which overwrites it (and updates photos here that use it).

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | object | yes | The contents of a profiles file (as exported). |
| `replace` | boolean | no | Overwrite your profiles that have the same id instead of adding copies. |

Examples:

- `{"file":{"format":"photo-profiles","version":1,"profiles":[{"name":"Shared Look","look":{"curves":{"red":[[0,0],[1,1]],"green":[[0,0],[1,1]],"blue":[[0,0],[1,1]]},"monochrome":null,"saturation":0,"fade":10,"splitToning":{"shadowHue":0,"shadowSaturation":0,"highlightHue":0,"highlightSaturation":0,"balance":0},"grain":{"amount":0,"size":25}}}]}}`: Import a profile.

#### List Profiles: `develop.profiles.list`

Query (no side effects)

List the available profiles: built-in film looks and the user's own, with id, name, group (color or bw), description, and how many photos in this folder use each. Pass includeLooks for their full settings.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `includeLooks` | boolean | no | Include each profile's look (curves, toning, grain…). |

Examples:

- `{}`: All profiles.

#### Edit Profile: `develop.profiles.update`

Command, undoable

Change one of the user's own profiles: rename it, change its description, or change look fields. Photos in this folder that use it are updated too (photos elsewhere keep the look they were given until it is applied again). Built-in profiles can't be changed.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Profile id, from develop.profiles.list. |
| `name` | string | no | New name. |
| `description` | string | no | New description. |
| `look` | object | no | Look fields to change; anything omitted is kept. |

Examples:

- `{"id":"user.my-sepia","name":"Warm Sepia"}`: Rename a profile.
- `{"id":"user.my-sepia","look":{"grain":{"amount":30}}}`: More grain.

#### Reset Develop Settings: `develop.reset`

Command, undoable · Shortcuts: `mod+shift+r`

Reset the selected photos' develop settings to unedited, or only the given groups.

*Available only when at least one photo is selected.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `groups` | `"profile"` \| `"wb"` \| `"basic"` \| `"presence"` \| `"effects"` \| `"toneCurve"` \| `"hsl"` \| `"crop"`[] | no | Only these groups (profile, wb, basic, presence, effects, toneCurve, hsl, crop). Omit for all. |
| `photoIds` | string[] | no | Photos to change. Omit to use the current selection. |

Examples:

- `{}`: Reset everything.
- `{"groups":["crop"]}`: Remove the crop only.

#### Apply Develop Settings: `develop.settings.apply`

Command, undoable

Apply several develop settings at once to the selected photos (a look or preset): any Basic sliders, tone curve, HSL bands, crop. Values replace the current ones; omitted settings are unchanged.

*Available only when at least one photo is selected.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `settings` | object | yes | Settings to change; anything omitted is left as it is. |
| `photoIds` | string[] | no | Photos to change. Omit to use the current selection. |

Examples:

- `{"settings":{"temperature":20,"contrast":-10,"saturation":-20,"toneCurve":[[0,0.06],[0.5,0.52],[1,0.94]]}}`: A warm, faded film look.
- `{"settings":{"saturation":-100}}`: Black and white.

#### Copy Settings: `develop.settings.copy`

Command · Shortcuts: `mod+shift+c`

Copy the active photo's develop settings (by default everything except crop) to paste onto other photos.

*Available only when a photo is active.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `groups` | `"profile"` \| `"wb"` \| `"basic"` \| `"presence"` \| `"effects"` \| `"toneCurve"` \| `"hsl"` \| `"crop"`[] | no | Settings groups: profile, wb, basic, presence, effects, toneCurve, hsl, crop. Defaults to everything except crop. |

Examples:

- `{}`: Copy all settings except crop.
- `{"groups":["wb","toneCurve"]}`: Copy only white balance and the curve.

#### Get Develop Settings: `develop.settings.get`

Query (no side effects)

Return a photo's full develop settings (the active photo by default) and whether it has been edited.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `photoId` | string | no | Defaults to the active photo. |

Examples:

- `{}`: Settings of the active photo.

#### Paste Settings: `develop.settings.paste`

Command, undoable · Shortcuts: `mod+shift+v`

Paste copied develop settings onto the selected photos (only the groups that were copied).

*Available only when at least one photo is selected and develop settings have been copied.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `photoIds` | string[] | no | Photos to change. Omit to use the current selection. |

Examples:

- `{}`: Paste onto the selection.

#### Sync Settings: `develop.settings.sync`

Command, undoable · Shortcuts: `mod+shift+s`

Copy the active photo's develop settings to every other selected photo (by default everything except crop).

*Available only when a photo is active and more than one photo is selected.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `groups` | `"profile"` \| `"wb"` \| `"basic"` \| `"presence"` \| `"effects"` \| `"toneCurve"` \| `"hsl"` \| `"crop"`[] | no | Settings groups: profile, wb, basic, presence, effects, toneCurve, hsl, crop. Defaults to everything except crop. |

Examples:

- `{}`: Sync everything except crop.
- `{"groups":["wb"]}`: Match white balance only.

#### Set Tone Curve: `develop.toneCurve.set`

Command, undoable

Replace the master tone curve on the selected photos with control points [input, output] in 0–1. [[0,0],[1,1]] is neutral; lifting the first point fades blacks, an S-shape adds contrast.

*Available only when at least one photo is selected.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `points` | any[][] | yes | Control points [input, output], 0–1. |
| `photoIds` | string[] | no | Photos to change. Omit to use the current selection. |

Examples:

- `{"points":[[0,0],[0.25,0.2],[0.75,0.8],[1,1]]}`: Gentle S-curve for contrast.
- `{"points":[[0,0.08],[1,0.95]]}`: Faded film look: lifted blacks, softer whites.

### History

#### Redo: `history.redo`

Command · Shortcuts: `mod+shift+z`

Redo the most recently undone change.

*Available only when there is an undone action to redo.*

#### Undo: `history.undo`

Command · Shortcuts: `mod+z`

Undo the most recent undoable change. A transaction (such as an applied AI plan) is undone as one step.

*Available only when there is an action to undo.*

## Context menus

Right-click menus (also opened with `app.contextMenu.open`). Each item runs the listed action.

### Photo: `grid.photo`

Right-click on a photo in the grid or filmstrip. Acts on the selection (the clicked photo is selected first).

- Set Rating
  - Clear Rating: `library.rating.set` `{"rating":0}`
  - Rate ★: `library.rating.set` `{"rating":1}`
  - Rate ★★: `library.rating.set` `{"rating":2}`
  - Rate ★★★: `library.rating.set` `{"rating":3}`
  - Rate ★★★★: `library.rating.set` `{"rating":4}`
  - Rate ★★★★★: `library.rating.set` `{"rating":5}`
- Set Flag
  - Flag as Pick: `library.flag.set` `{"flag":"pick"}`
  - Flag as Rejected: `library.flag.set` `{"flag":"reject"}`
  - Remove Flag: `library.flag.set` `{"flag":"none"}`
- Set Color Label
  - Label Red: `library.colorLabel.set` `{"label":"red"}`
  - Label Yellow: `library.colorLabel.set` `{"label":"yellow"}`
  - Label Green: `library.colorLabel.set` `{"label":"green"}`
  - Label Blue: `library.colorLabel.set` `{"label":"blue"}`
  - Label Purple: `library.colorLabel.set` `{"label":"purple"}`
  - Remove Color Label: `library.colorLabel.set` `{"label":"none"}`
- Develop
  - Auto Tone: `develop.auto`
  - Auto White Balance: `develop.auto` `{"include":["wb"]}`
  - Profile
    - Warm Portrait: `develop.profile.set` `{"profileId":"builtin.warm-portrait"}`
    - Vivid Slide: `develop.profile.set` `{"profileId":"builtin.vivid-slide"}`
    - Golden Hour: `develop.profile.set` `{"profileId":"builtin.golden-hour"}`
    - Faded Print: `develop.profile.set` `{"profileId":"builtin.faded-print"}`
    - Matte: `develop.profile.set` `{"profileId":"builtin.matte"}`
    - Cool Cinema: `develop.profile.set` `{"profileId":"builtin.cool-cinema"}`
    - Soft Pastel: `develop.profile.set` `{"profileId":"builtin.soft-pastel"}`
    - Cross Process: `develop.profile.set` `{"profileId":"builtin.cross-process"}`
    - Classic B&W: `develop.profile.set` `{"profileId":"builtin.classic-bw"}`
    - High Contrast B&W: `develop.profile.set` `{"profileId":"builtin.high-contrast-bw"}`
    - Soft B&W: `develop.profile.set` `{"profileId":"builtin.soft-bw"}`
    - Selenium: `develop.profile.set` `{"profileId":"builtin.selenium"}`
    - Sepia: `develop.profile.set` `{"profileId":"builtin.sepia"}`
    - None: `develop.profile.set` `{"profileId":"none"}`
  - Sync Settings: `develop.settings.sync`
  - Reset Develop Settings: `develop.reset`
- Open in Loupe: `view.set` `{"view":"loupe"}`
- Open in Develop: `view.set` `{"view":"develop"}`
- Select All: `library.selection.all`
- Toggle RAW+JPEG Grouping: `library.pairs.toggle`
- Remove Rejected Photos: `library.rejected.remove`

### Photo: `loupe.photo`

Right-click on the photo in Loupe or Develop.

- Set Rating
  - Clear Rating: `library.rating.set` `{"rating":0}`
  - Rate ★: `library.rating.set` `{"rating":1}`
  - Rate ★★: `library.rating.set` `{"rating":2}`
  - Rate ★★★: `library.rating.set` `{"rating":3}`
  - Rate ★★★★: `library.rating.set` `{"rating":4}`
  - Rate ★★★★★: `library.rating.set` `{"rating":5}`
- Set Flag
  - Flag as Pick: `library.flag.set` `{"flag":"pick"}`
  - Flag as Rejected: `library.flag.set` `{"flag":"reject"}`
  - Remove Flag: `library.flag.set` `{"flag":"none"}`
- Set Color Label
  - Label Red: `library.colorLabel.set` `{"label":"red"}`
  - Label Yellow: `library.colorLabel.set` `{"label":"yellow"}`
  - Label Green: `library.colorLabel.set` `{"label":"green"}`
  - Label Blue: `library.colorLabel.set` `{"label":"blue"}`
  - Label Purple: `library.colorLabel.set` `{"label":"purple"}`
  - Remove Color Label: `library.colorLabel.set` `{"label":"none"}`
- Develop
  - Auto Tone: `develop.auto`
  - Auto White Balance: `develop.auto` `{"include":["wb"]}`
  - Profile
    - Warm Portrait: `develop.profile.set` `{"profileId":"builtin.warm-portrait"}`
    - Vivid Slide: `develop.profile.set` `{"profileId":"builtin.vivid-slide"}`
    - Golden Hour: `develop.profile.set` `{"profileId":"builtin.golden-hour"}`
    - Faded Print: `develop.profile.set` `{"profileId":"builtin.faded-print"}`
    - Matte: `develop.profile.set` `{"profileId":"builtin.matte"}`
    - Cool Cinema: `develop.profile.set` `{"profileId":"builtin.cool-cinema"}`
    - Soft Pastel: `develop.profile.set` `{"profileId":"builtin.soft-pastel"}`
    - Cross Process: `develop.profile.set` `{"profileId":"builtin.cross-process"}`
    - Classic B&W: `develop.profile.set` `{"profileId":"builtin.classic-bw"}`
    - High Contrast B&W: `develop.profile.set` `{"profileId":"builtin.high-contrast-bw"}`
    - Soft B&W: `develop.profile.set` `{"profileId":"builtin.soft-bw"}`
    - Selenium: `develop.profile.set` `{"profileId":"builtin.selenium"}`
    - Sepia: `develop.profile.set` `{"profileId":"builtin.sepia"}`
    - None: `develop.profile.set` `{"profileId":"none"}`
  - Sync Settings: `develop.settings.sync`
  - Reset Develop Settings: `develop.reset`
- Toggle Zoom: `view.zoom.toggle`
- Toggle Info Overlay: `view.info.toggle`
- Toggle Filmstrip: `view.filmstrip.toggle`
- Crop & Straighten: `develop.cropTool.toggle`
- Show in Grid: `view.set` `{"view":"grid"}`

### More: `app.more`

The “⋯” button at the top right on small screens: the tools that have no room in the top bar there.

- AI Conversation: `app.ai.panel.toggle`
- Toggle Command Palette: `app.palette.open`
- Undo: `history.undo`
- Redo: `history.redo`
- Toggle Info Overlay: `view.info.toggle`
- Toggle Filmstrip: `view.filmstrip.toggle`
- Toggle Light/Dark Theme: `app.theme.toggle`
- Keyboard Shortcuts: `app.shortcuts.open`
- AI Settings…: `app.ai.settings.open`
- Add a Passkey: `app.account.passkey.add`
- Sign Out: `app.account.signOut`
