import { z } from "zod";
import { defineAction } from "../core/actions/types";
import { all, folderWritable, hasRejected, hasRemoved } from "../core/actions/when";
import { TRASH_DIR } from "../core/library/formats";
import { emptyTrash, removePhotos, restorePhotos } from "../core/library/trash";

export const removeRejected = defineAction({
  id: "library.rejected.remove",
  sideEffects: true,
  title: "Remove Rejected Photos",
  description:
    `Move rejected photos (and their XMP sidecars) out of the library into the folder's ${TRASH_DIR} ` +
    "subfolder. Nothing is deleted: undo, or Restore Removed Photos, brings them back until that folder is " +
    "emptied. Defaults to every rejected photo; photoIds limits it to some of them.",
  category: "Library",
  kind: "command",
  undoable: true,
  when: all(folderWritable, hasRejected),
  params: z
    .object({
      photoIds: z.array(z.string()).min(1).optional().describe("Only these rejected photos. Omit for all rejected photos."),
    })
    .optional(),
  examples: [
    { params: {}, description: "Move every rejected photo to the _Rejected folder." },
    { params: { photoIds: ["DSC_0007.jpg"] }, description: "Move one rejected photo." },
  ],
  defaultShortcuts: [{ keys: "mod+backspace" }],
  targets: (params, ctx) =>
    params?.photoIds ?? ctx.state.photos.order.filter((id) => ctx.state.photos.byId[id]?.flag === "reject"),
  async run(params, ctx) {
    const { byId, order } = ctx.state.photos;
    const ids = params?.photoIds ?? order.filter((id) => byId[id]?.flag === "reject");
    const notRejected = ids.filter((id) => byId[id]?.flag !== "reject");
    if (notRejected.length) throw new Error(`Only rejected photos can be removed; flag these as rejected first: ${notRejected.slice(0, 5).join(", ")}`);
    return removePhotos(ctx, ids);
  },
});

export const restoreRemoved = defineAction({
  id: "library.removed.restore",
  sideEffects: true,
  title: "Restore Removed Photos",
  description: `Move photos back from the ${TRASH_DIR} subfolder to where they were, with their ratings and sidecars. Defaults to all of them. Undoable.`,
  category: "Library",
  kind: "command",
  undoable: true,
  when: all(folderWritable, hasRemoved),
  params: z
    .object({
      photoIds: z.array(z.string()).min(1).optional().describe("Original paths to restore (see List Removed Photos). Omit for all."),
    })
    .optional(),
  examples: [
    { params: {}, description: "Restore everything that was removed." },
    { params: { photoIds: ["day2/IMG_0003.jpg"] }, description: "Restore one photo." },
  ],
  run: (params, ctx) => restorePhotos(ctx, params?.photoIds),
});

export const emptyRemoved = defineAction({
  id: "library.removed.empty",
  sideEffects: true,
  title: "Delete Removed Photos Permanently",
  description:
    `Permanently delete everything in the ${TRASH_DIR} subfolder. This cannot be undone and the files do not ` +
    "go to the system Trash, and it clears undo history. Requires confirm: true; always ask the user first.",
  category: "Library",
  kind: "command",
  when: all(folderWritable, hasRemoved),
  params: z.object({
    confirm: z.literal(true).describe("Must be true: confirms the user agreed to delete the files permanently."),
  }),
  examples: [{ params: { confirm: true }, description: "After the user confirms, delete the removed photos for good." }],
  run: (_, ctx) => emptyTrash(ctx),
});

export const listRemoved = defineAction({
  id: "library.removed.list",
  title: "List Removed Photos",
  description: `Return photos in the ${TRASH_DIR} subfolder by their original path, with size and modified time.`,
  category: "Library",
  kind: "query",
  async run(_, ctx) {
    const source = ctx.services.library.current();
    return source ? source.listTrash() : [];
  },
});

export const trashActions = [removeRejected, restoreRemoved, emptyRemoved, listRemoved];
