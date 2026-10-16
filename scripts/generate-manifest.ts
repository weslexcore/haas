/**
 * Generates generated/actions.json and generated/SKILL.md from the action registry.
 *   yarn manifest         write the files
 *   yarn manifest:check   exit 1 if the committed files are out of date
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createActionRegistry } from "../src/actions";
import { availableWorkflows, buildManifest, serializeManifest } from "../src/core/manifest/build-manifest";
import { renderSkillMd } from "../src/core/manifest/render-skill-md";
import { MenuRegistry } from "../src/core/menus/registry";
import { allMenus } from "../src/menus";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const registry = createActionRegistry();
const manifest = buildManifest(registry, new MenuRegistry().registerAll(allMenus));
const outputs = {
  "generated/actions.json": serializeManifest(manifest),
  "generated/SKILL.md": renderSkillMd(manifest),
};

let stale = 0;
for (const [rel, content] of Object.entries(outputs)) {
  const path = resolve(root, rel);
  if (check) {
    const current = await readFile(path, "utf8").catch(() => null);
    if (current !== content) {
      console.error(`✗ ${rel} is out of date. Run \`yarn manifest\` and commit the result.`);
      stale++;
    }
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    console.log(`✓ wrote ${rel}`);
  }
}

const { skipped } = availableWorkflows(registry);
if (!check && skipped.length) {
  console.log(`  (${skipped.length} workflow(s) waiting for actions that don't exist yet: ${skipped.map((w) => w.title).join("; ")})`);
}
if (check && stale === 0) console.log(`✓ manifest up to date (${manifest.actions.length} actions)`);
process.exit(stale ? 1 : 0);
