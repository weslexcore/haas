import { BUILTIN_PROFILES } from "../core/develop/profiles";
import { choices, item, separator, submenu, type MenuDefinition, type MenuItem } from "../core/menus/registry";

const culling: MenuItem[] = [
  submenu("Set Rating", choices("library.rating.set", "rating", [0, 1, 2, 3, 4, 5])),
  submenu("Set Flag", choices("library.flag.set", "flag", ["pick", "reject", "none"])),
  submenu("Set Color Label", choices("library.colorLabel.set", "label", ["red", "yellow", "green", "blue", "purple", "none"])),
];

const develop: MenuItem = submenu("Develop", [
  item("develop.auto"),
  item("develop.auto", { include: ["wb"] }),
  submenu("Profile", [
    ...BUILTIN_PROFILES.map((p) => item("develop.profile.set", { profileId: p.id }, p.name)),
    separator,
    item("develop.profile.set", { profileId: "none" }, "None"),
  ]),
  separator,
  item("develop.settings.sync"),
  item("develop.reset"),
]);

/** All context menus. Items are action references; see docs/adding-an-action.md. */
export const allMenus: readonly MenuDefinition[] = [
  {
    id: "grid.photo",
    title: "Photo",
    description: "Right-click on a photo in the grid or filmstrip. Acts on the selection (the clicked photo is selected first).",
    items: [
      ...culling,
      develop,
      item("develop.export", undefined, "Export JPEG…"),
      separator,
      item("view.set", { view: "loupe" }, "Open in Loupe"),
      item("view.set", { view: "develop" }, "Open in Develop"),
      separator,
      item("library.selection.all"),
      item("library.pairs.toggle"),
      separator,
      item("library.rejected.remove"),
    ],
  },
  {
    id: "loupe.photo",
    title: "Photo",
    description: "Right-click on the photo in Loupe or Develop.",
    items: [
      ...culling,
      develop,
      item("develop.export", undefined, "Export JPEG…"),
      separator,
      item("view.zoom.toggle"),
      item("view.info.toggle"),
      item("view.filmstrip.toggle"),
      separator,
      item("develop.cropTool.toggle", undefined, "Crop & Straighten"),
      item("view.set", { view: "grid" }, "Show in Grid"),
    ],
  },
  {
    id: "app.more",
    title: "More",
    description: "The “⋯” button at the top right on small screens: the tools that have no room in the top bar there.",
    items: [
      item("app.ai.panel.toggle", undefined, "AI Conversation"),
      item("app.palette.open"),
      separator,
      item("history.undo"),
      item("history.redo"),
      separator,
      item("view.info.toggle"),
      item("view.filmstrip.toggle"),
      item("app.theme.toggle"),
      item("app.shortcuts.open"),
      item("app.ai.settings.open"),
      separator,
      item("app.account.passkey.add"),
      item("app.account.signOut"),
    ],
  },
];
