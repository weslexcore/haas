/**
 * Hand-written concept text and workflow recipes for SKILL.md. Action details
 * are never written here — they come from the registry. Workflows reference
 * action ids and only appear in the manifest once every step's action exists.
 */

export const APP_INFO = {
  name: "Photon",
  description:
    "A browser-based photo culling and editing app, in the spirit of Lightroom. Users open a folder of photos, " +
    "cull them (rate, flag, colour-label), make non-destructive edits, and export. Every operation is an action " +
    "in a central registry; the keyboard, menus, command palette and AI all dispatch the same actions.",
};

export interface Concept {
  term: string;
  explanation: string;
}

export const CONCEPTS: Concept[] = [
  {
    term: "Library",
    explanation:
      "The set of photos currently loaded, in display order. Each photo has an id, file name, capture time, " +
      "rating, flag and colour label. Image file contents are never modified.",
  },
  {
    term: "Selection",
    explanation:
      "One or more selected photos, plus one active photo (the one shown in Loupe and Develop). Library commands " +
      "that accept an optional `photoIds` parameter act on the selection when it is omitted.",
  },
  {
    term: "Ratings",
    explanation: "An integer from 0 (unrated) to 5 stars.",
  },
  {
    term: "Flags",
    explanation: "`pick`, `reject` or `none` (unflagged). Rejects are typically hidden or deleted later.",
  },
  {
    term: "Colour labels",
    explanation: "`red`, `yellow`, `green`, `blue`, `purple` or `none`, used for ad-hoc grouping.",
  },
  {
    term: "Filter and sort",
    explanation:
      "The on-screen library can be filtered (minimum rating, flags, labels, file name) and sorted. Navigation " +
      "and Select All follow what is visible. Query actions can filter independently of the screen.",
  },
  {
    term: "Auto-advance",
    explanation:
      "After a rating, flag or label command on a single photo, the app can move to the next photo: only while " +
      "Caps Lock is on (default, as in Lightroom), always, or never. AI and scripts pass advance: true instead.",
  },
  {
    term: "Folders and sidecars",
    explanation:
      "The library is one folder (with subfolders). Ratings, flags and labels are stored in the app and, when " +
      "the folder was opened with write access, in XMP sidecars next to the photos so Lightroom, Bridge and " +
      "darktable can read them. The contents of photos are never modified.",
  },
  {
    term: "RAW files",
    explanation:
      "Camera RAW files (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2 and others; mimeType image/x-…) are photos like " +
      "any other: rated, edited and exported the same way. A RAW and a JPEG with the same name are one photo " +
      "(the RAW, with companion set to the JPEG's path); the JPEG moves with it when it is removed.",
  },
  {
    term: "Seeing photos",
    explanation:
      "Metadata (rating, flags, EXIF, capture time) comes from query actions. To judge what is in a photo " +
      "(sharpness, faces, subject, colour, how an edit looks), view it with library.photos.view, which returns " +
      "images with the current edits applied. Viewing costs tokens: scan with thumbnails, check focus with detail.",
  },
  {
    term: "Removing photos",
    explanation:
      "Rejected photos can be removed from the library: they move, with their sidecars, into a _Rejected " +
      "subfolder of the open folder and can be restored from there. Only emptying that folder deletes files, " +
      "permanently (not to the system Trash), and it needs the user's explicit confirmation.",
  },
  {
    term: "Views",
    explanation:
      "`grid` shows thumbnails for fast scanning, `loupe` shows the active photo large for close review, and " +
      "`develop` shows the active photo with editing controls.",
  },
  {
    term: "Edit recipes",
    explanation:
      "Non-destructive develop settings stored per photo as JSON: white balance (temperature, tint), exposure, " +
      "contrast, highlights, shadows, whites, blacks, vibrance, saturation, a post-crop vignette, a tone curve, HSL per colour band, " +
      "and crop/straighten, plus an optional profile. Rendered on the GPU; saved with the ratings and in the XMP sidecar. Exports apply " +
      "them at full resolution. A photo with default settings is unedited.",
  },
  {
    term: "Profiles",
    explanation:
      "A profile is a film look applied under the sliders (as in Lightroom): colour or black and white, " +
      "per-channel curves, split toning, fade and grain, with an amount (0–200%). Applying one keeps the " +
      "sliders. There are built-in profiles (ids `builtin.…`) and the user's own (`user.…`), which can be " +
      "created, edited, deleted, and exported to or imported from JSON files. A photo's edit holds a copy " +
      "of its profile's look, so it renders the same where that profile isn't installed.",
  },
  {
    term: "Auto",
    explanation:
      "`develop.auto` sets tone (exposure, contrast, highlights, shadows, whites, blacks, vibrance) and/or " +
      "white balance from each photo's own pixels, inside its crop, accounting for its profile. Each photo " +
      "is analysed separately, so a batch gets individual settings in one undo step.",
  },
  {
    term: "Undo and transactions",
    explanation:
      "Undoable commands are recorded in history. A transaction groups several commands into one undo step; " +
      "AI-proposed plans are always applied as a single transaction after the user reviews them.",
  },
];

export interface WorkflowStep {
  actionId: string;
  params?: unknown;
  note: string;
}

export interface Workflow {
  title: string;
  goal: string;
  steps: WorkflowStep[];
}

export const WORKFLOWS: Workflow[] = [
  {
    title: "Reject the blurry frames in a burst",
    goal: "Keep the sharpest of several near-identical photos.",
    steps: [
      { actionId: "library.photos.list", params: { capturedAfter: "2026-09-12T06:30", capturedBefore: "2026-09-12T06:35" }, note: "Find the burst by capture time." },
      { actionId: "library.photos.view", params: { photoIds: ["DSC_0001.jpg", "DSC_0002.jpg", "DSC_0003.jpg"], size: "thumbnail" }, note: "Compare them; use detail size on the best candidates to check focus." },
      { actionId: "library.flag.set", params: { flag: "reject", photoIds: ["DSC_0001.jpg", "DSC_0003.jpg"] }, note: "Reject the softer frames." },
      { actionId: "library.flag.set", params: { flag: "pick", photoIds: ["DSC_0002.jpg"] }, note: "Pick the sharpest." },
    ],
  },
  {
    title: "Give the selected photos a warm film look",
    goal: "Warm, slightly faded, less saturated, as one undoable step.",
    steps: [
      {
        actionId: "develop.settings.apply",
        params: {
          settings: { temperature: 20, contrast: -10, saturation: -20, toneCurve: [[0, 0.06], [0.5, 0.52], [1, 0.94]] },
        },
        note: "Applies to every selected photo.",
      },
    ],
  },
  {
    title: "Give a set of photos a consistent look",
    goal: "Apply one film profile to the selection, then correct each photo's exposure and white balance individually.",
    steps: [
      { actionId: "develop.profiles.list", note: "Choose a profile by its description (or the user's own)." },
      { actionId: "develop.profile.set", params: { profileId: "builtin.warm-portrait" }, note: "Apply it to every selected photo." },
      { actionId: "develop.auto", params: { include: ["wb", "tone"] }, note: "Then Auto, so each photo is corrected under the profile." },
    ],
  },
  {
    title: "Make a reusable profile",
    goal: "Save a look as one of the user's own profiles and apply it.",
    steps: [
      {
        actionId: "develop.profiles.create",
        params: { name: "Moody Teal", from: "builtin.cool-cinema", look: { fade: 10, grain: { amount: 20 } } },
        note: "Start from a built-in look and change some fields; returns the new id.",
      },
      { actionId: "develop.profile.set", params: { profileId: "user.moody-teal" }, note: "Apply it with the returned id." },
      { actionId: "develop.profiles.export", params: { ids: ["user.moody-teal"] }, note: "Optionally save it to a file to share." },
    ],
  },
  {
    title: "Edit one photo, then match the rest",
    goal: "Develop the active photo and copy its look to the other selected photos.",
    steps: [
      { actionId: "develop.adjust", params: { setting: "exposure", value: 0.5 }, note: "Adjust the active photo (select just it first)." },
      { actionId: "library.selection.all", note: "Select the photos to match." },
      { actionId: "develop.settings.sync", note: "Copies everything except crop from the active photo." },
    ],
  },
  {
    title: "Cull a shoot",
    goal: "Go through every photo once, picking keepers and rejecting the rest.",
    steps: [
      { actionId: "app.context.get", note: "Check what is loaded and which photo is active." },
      { actionId: "view.set", params: { view: "loupe" }, note: "Review one photo at a time at a large size." },
      { actionId: "library.flag.set", params: { flag: "pick", advance: true }, note: "Pick the active photo and move on…" },
      { actionId: "library.flag.set", params: { flag: "reject", advance: true }, note: "…or reject it and move on." },
      { actionId: "library.filter.set", params: { flags: ["pick"] }, note: "Afterwards, show only the picks." },
    ],
  },
  {
    title: "Rate a batch of selected photos",
    goal: "Give the current selection the same star rating in one undoable step.",
    steps: [
      { actionId: "library.selection.get", note: "Confirm which photos are selected." },
      { actionId: "library.rating.set", params: { rating: 3 }, note: "Rate them all; omit photoIds to use the selection." },
    ],
  },
  {
    title: "Show only the best photos",
    goal: "Find the photos rated 4 stars or more.",
    steps: [
      { actionId: "library.photos.list", params: { minRating: 4 }, note: "Find them (ids, names, metadata)." },
      { actionId: "library.filter.set", params: { minRating: 4 }, note: "Or show only them on screen." },
    ],
  },
  {
    title: "Show this morning's best photos",
    goal: "Find 4+ star photos captured before noon on a given day.",
    steps: [
      { actionId: "app.context.get", note: "Check the folder and the capture dates in view." },
      {
        actionId: "library.photos.list",
        params: { minRating: 4, capturedAfter: "2026-09-12T00:00", capturedBefore: "2026-09-12T12:00" },
        note: "Capture times are camera-local.",
      },
      { actionId: "library.selection.set", params: { ids: ["DSC_0003.jpg", "DSC_0007.jpg"] }, note: "Select the matches by id." },
    ],
  },
  {
    title: "Warm up and brighten the selection",
    goal: "Apply a warmer white balance and a little more exposure to every selected photo.",
    steps: [
      { actionId: "library.selection.get", note: "Check which photos are selected." },
      { actionId: "develop.adjust", params: { setting: "temperature", delta: 15 }, note: "Shift white balance warmer, relative to each photo." },
      { actionId: "develop.adjust", params: { setting: "exposure", delta: 0.3 }, note: "Raise exposure by a third of a stop." },
    ],
  },
];
