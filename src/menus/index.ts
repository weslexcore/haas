import { choices, item, separator, submenu, type MenuDefinition, type MenuItem } from "../core/menus/registry";

const culling: MenuItem[] = [
  submenu("Set Rating", choices("library.rating.set", "rating", [0, 1, 2, 3, 4, 5])),
  submenu("Set Flag", choices("library.flag.set", "flag", ["pick", "reject", "none"])),
  submenu("Set Color Label", choices("library.colorLabel.set", "label", ["red", "yellow", "green", "blue", "purple", "none"])),
];

/** All context menus. Items are action references; see docs/adding-an-action.md. */
export const allMenus: readonly MenuDefinition[] = [
  {
    id: "grid.photo",
    title: "Photo",
    description: "Right-click on a photo in the grid or filmstrip. Acts on the selection (the clicked photo is selected first).",
    items: [
      ...culling,
      separator,
      item("view.set", { view: "loupe" }, "Open in Loupe"),
      item("view.set", { view: "develop" }, "Open in Develop"),
      separator,
      item("library.selection.all"),
    ],
  },
  {
    id: "loupe.photo",
    title: "Photo",
    description: "Right-click on the photo in Loupe or Develop.",
    items: [
      ...culling,
      separator,
      item("view.zoom.toggle"),
      item("view.info.toggle"),
      item("view.filmstrip.toggle"),
      separator,
      item("view.set", { view: "grid" }, "Show in Grid"),
    ],
  },
];
