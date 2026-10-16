# Photo: operating guide

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

**Removing photos.** Rejected photos can be removed from the library: they move, with their sidecars, into a _Rejected subfolder of the open folder and can be restored from there. Only emptying that folder deletes files, permanently (not to the system Trash), and it needs the user's explicit confirmation.

**Views.** `grid` shows thumbnails for fast scanning, `loupe` shows the active photo large for close review, and `develop` shows the active photo with editing controls.

**Edit recipes.** Non-destructive develop settings stored per photo as JSON (exposure, contrast, white balance, …) and rendered on the GPU. (Arrive in Phase 3.)

**Undo and transactions.** Undoable commands are recorded in history. A transaction groups several commands into one undo step; AI-proposed plans are always applied as a single transaction after the user reviews them.

## Workflows

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

## Actions

### App

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

#### Ask AI: `app.ai.ask`

Command

Send a natural-language request to the AI provider together with the action manifest and current context. Returns a proposed plan (ordered actions with reasons) for the user to review; it does not apply anything.

*Always available.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `prompt` | string | yes | What the user wants, in their own words. |

Examples:

- `{"prompt":"Show me only 4+ star photos"}`: Ask for a plan to filter the library.

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

Open a context menu. Without menuId, opens the photo menu for the current view next to the active photo (the keyboard equivalent of right-clicking it). x/y place it at a viewport position.

*Available only when the library contains photos.*

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

#### Toggle Filmstrip: `view.filmstrip.toggle`

Command · Shortcuts: `f6`

Show or hide the strip of thumbnails below the photo in Loupe and Develop.

*Always available.*

#### Toggle Info Overlay: `view.info.toggle`

Command · Shortcuts: `i`

Show or hide capture details (camera, lens, exposure, time) over the photo in Loupe and Develop.

*Available only when the current view is Loupe or Develop.*

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

Command · Shortcuts: `mod+backspace`

Move rejected photos (and their XMP sidecars) out of the library into the folder's _Rejected subfolder. Nothing is deleted: Restore Removed Photos brings them back until that folder is emptied. Defaults to every rejected photo; photoIds limits it to some of them. Clears undo history.

*Available only when the folder was opened with write access and at least one photo is flagged rejected.*

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `photoIds` | string[] | no | Only these rejected photos. Omit for all rejected photos. |

Examples:

- `{}`: Move every rejected photo to the _Rejected folder.
- `{"photoIds":["DSC_0007.jpg"]}`: Move one rejected photo.

#### Delete Removed Photos Permanently: `library.removed.empty`

Command

Permanently delete everything in the _Rejected subfolder. This cannot be undone and the files do not go to the system Trash. Requires confirm: true; always ask the user before doing this.

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

Command

Move photos back from the _Rejected subfolder to where they were, with their ratings and sidecars. Defaults to all of them.

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
- Open in Loupe: `view.set` `{"view":"loupe"}`
- Open in Develop: `view.set` `{"view":"develop"}`
- Select All: `library.selection.all`
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
- Toggle Zoom: `view.zoom.toggle`
- Toggle Info Overlay: `view.info.toggle`
- Toggle Filmstrip: `view.filmstrip.toggle`
- Show in Grid: `view.set` `{"view":"grid"}`
