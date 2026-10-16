/**
 * Hand-written concept text and workflow recipes for SKILL.md. Action details
 * are never written here — they come from the registry. Workflows reference
 * action ids and only appear in the manifest once every step's action exists.
 */

export const APP_INFO = {
  name: "Photo",
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
      "rating, flag and colour label. Original image files are never modified.",
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
      "darktable can read them. Photos themselves are never modified.",
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
      "Non-destructive develop settings stored per photo as JSON (exposure, contrast, white balance, …) and " +
      "rendered on the GPU. (Arrive in Phase 3.)",
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
      { actionId: "develop.whiteBalance.temperature.adjust", params: { amount: 400 }, note: "Shift white balance warmer." },
      { actionId: "develop.exposure.adjust", params: { amount: 0.3 }, note: "Raise exposure by a third of a stop." },
    ],
  },
];
