import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createActionRegistry } from "../../src/actions";
import { buildManifest, serializeManifest } from "../../src/core/manifest/build-manifest";
import { WORKFLOWS } from "../../src/core/manifest/concepts";
import { renderSkillMd } from "../../src/core/manifest/render-skill-md";
import { MenuRegistry, menuActionItems } from "../../src/core/menus/registry";
import { allMenus } from "../../src/menus";

const registry = createActionRegistry();
const menus = new MenuRegistry().registerAll(allMenus);
const manifest = buildManifest(registry, menus);

describe("menus", () => {
  it("only reference existing, public actions with valid params", () => {
    for (const menu of allMenus) {
      for (const item of menuActionItems(menu.items)) {
        const action = registry.get(item.actionId);
        expect(action, `${menu.id}: ${item.actionId}`).toBeDefined();
        expect(action!.internal, `${menu.id}: ${item.actionId} is internal`).toBeFalsy();
        if (action!.params) expect(action!.params.safeParse(item.params).success, `${menu.id}: ${item.actionId}`).toBe(true);
        else expect(item.params).toBeUndefined();
      }
    }
  });
});

describe("manifest", () => {
  it("includes every registered action with availability in plain language", () => {
    const publicIds = registry.all().filter((a) => !a.internal).map((a) => a.id);
    expect(manifest.actions.map((a) => a.id).sort()).toEqual(publicIds.sort());
    const toggle = manifest.actions.find((a) => a.id === "view.beforeAfter.toggle")!;
    expect(toggle.availability).toBe("Available only when the current view is Develop.");
  });

  it("emits JSON Schema for params", () => {
    const rating = manifest.actions.find((a) => a.id === "library.rating.set")!;
    expect(rating.params).toMatchObject({
      type: "object",
      required: ["rating"],
      properties: { rating: { type: "integer", minimum: 0, maximum: 5 } },
    });
    expect(manifest.actions.find((a) => a.id === "navigation.next")!.params).toBeNull();
  });

  it("is deterministic", () => {
    expect(serializeManifest(buildManifest(createActionRegistry(), menus))).toBe(serializeManifest(manifest));
  });

  it("leaves internal actions out", () => {
    expect(manifest.actions.find((a) => a.id === "library.index.apply")).toBeUndefined();
    expect(renderSkillMd(manifest)).not.toContain("library.index.apply");
  });

  it("documents context menus with resolved labels", () => {
    const grid = manifest.menus.find((m) => m.id === "grid.photo")!;
    expect(grid.items[0]).toMatchObject({ kind: "submenu", label: "Set Rating" });
    expect(renderSkillMd(manifest)).toContain("- Rate ★★★: `library.rating.set` `{\"rating\":3}`");
  });

  it("only includes workflows whose actions all exist", () => {
    for (const w of manifest.workflows) {
      for (const step of w.steps) expect(registry.get(step.actionId), step.actionId).toBeDefined();
    }
    expect(manifest.workflows.length).toBeLessThanOrEqual(WORKFLOWS.length);
  });

  it("workflow params validate against their action schemas", () => {
    for (const w of manifest.workflows) {
      for (const step of w.steps) {
        const action = registry.get(step.actionId)!;
        if (action.params) expect(action.params.safeParse(step.params).success, `${w.title}: ${step.actionId}`).toBe(true);
      }
    }
  });

  it("committed generated files are up to date (run `yarn manifest`)", () => {
    const root = resolve(import.meta.dirname, "../..");
    expect(readFileSync(resolve(root, "generated/actions.json"), "utf8")).toBe(serializeManifest(manifest));
    expect(readFileSync(resolve(root, "generated/SKILL.md"), "utf8")).toBe(renderSkillMd(manifest));
  });
});
