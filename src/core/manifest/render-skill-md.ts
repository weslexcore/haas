import { CATEGORY_ORDER, type JSONSchema, type Manifest, type ManifestAction, type ManifestMenuItem } from "./build-manifest";

/** Render SKILL.md from the manifest. Pure and deterministic. */
export function renderSkillMd(m: Manifest): string {
  const out: string[] = [];
  const line = (s = "") => out.push(s);

  line(`# ${m.app.name}: operating guide`);
  line();
  line("> Generated from the action registry by `scripts/generate-manifest.ts`. Do not edit by hand.");
  line("> The machine-readable version is `actions.json`.");
  line();
  line("## What this app is");
  line();
  line(m.app.description);
  line();
  line("## How to operate it");
  line();
  for (const c of m.conventions) line(`- ${c}`);
  line();
  line("## Concepts");
  line();
  for (const c of m.concepts) {
    line(`**${c.term}.** ${c.explanation}`);
    line();
  }

  if (m.workflows.length) {
    line("## Workflows");
    line();
    for (const w of m.workflows) {
      line(`### ${w.title}`);
      line();
      line(w.goal);
      line();
      w.steps.forEach((s, i) => {
        const params = s.params === undefined ? "" : ` \`${JSON.stringify(s.params)}\``;
        line(`${i + 1}. \`${s.actionId}\`${params}: ${s.note}`);
      });
      line();
    }
  }

  line("## Actions");
  line();
  for (const category of CATEGORY_ORDER) {
    const actions = m.actions.filter((a) => a.category === category);
    if (!actions.length) continue;
    line(`### ${category}`);
    line();
    for (const a of actions) renderAction(a, line);
  }

  if (m.menus.length) {
    line("## Context menus");
    line();
    line("Right-click menus (also opened with `app.contextMenu.open`). Each item runs the listed action.");
    line();
    for (const menu of m.menus) {
      line(`### ${menu.title}: \`${menu.id}\``);
      line();
      line(menu.description);
      line();
      renderMenuItems(menu.items, 0, line);
      line();
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function renderMenuItems(items: ManifestMenuItem[], depth: number, line: (s?: string) => void): void {
  const indent = "  ".repeat(depth);
  for (const item of items) {
    if (item.kind === "separator") continue;
    if (item.kind === "submenu") {
      line(`${indent}- ${item.label}`);
      renderMenuItems(item.items, depth + 1, line);
    } else {
      const params = item.params === undefined ? "" : ` \`${JSON.stringify(item.params)}\``;
      line(`${indent}- ${item.label}: \`${item.actionId}\`${params}`);
    }
  }
}

function renderAction(a: ManifestAction, line: (s?: string) => void): void {
  line(`#### ${a.title}: \`${a.id}\``);
  line();
  const facts = [a.kind === "query" ? "Query (no side effects)" : a.undoable ? "Command, undoable" : "Command"];
  if (a.defaultShortcuts.length) {
    facts.push(
      "Shortcuts: " +
        a.defaultShortcuts
          .map((s) => `\`${s.keys}\`${s.params !== undefined ? ` → \`${JSON.stringify(s.params)}\`` : ""}`)
          .join(", "),
    );
  }
  line(facts.join(" · "));
  line();
  line(a.description);
  line();
  line(`*${a.availability}*`);
  line();

  const props = (a.params?.properties ?? {}) as Record<string, JSONSchema>;
  const required = new Set((a.params?.required as string[] | undefined) ?? []);
  if (Object.keys(props).length) {
    line("| Parameter | Type | Required | Description |");
    line("| --- | --- | --- | --- |");
    for (const [name, schema] of Object.entries(props)) {
      const desc = String(schema.description ?? "").replace(/\|/g, "\\|");
      line(`| \`${name}\` | ${describeType(schema)} | ${required.has(name) ? "yes" : "no"} | ${desc} |`);
    }
    line();
  }
  if (a.examples.length) {
    line("Examples:");
    line();
    for (const ex of a.examples) line(`- \`${JSON.stringify(ex.params)}\`: ${ex.description}`);
    line();
  }
}

export function describeType(schema: JSONSchema): string {
  let t: string;
  if (Array.isArray(schema.enum)) t = schema.enum.map((v) => `\`${JSON.stringify(v)}\``).join(" \\| ");
  else if (schema.type === "array") t = `${describeType((schema.items ?? {}) as JSONSchema)}[]`;
  else t = String(schema.type ?? "any");
  const range =
    typeof schema.minimum === "number" || typeof schema.maximum === "number"
      ? ` (${schema.minimum ?? "…"}–${schema.maximum ?? "…"})`
      : "";
  const def = schema.default !== undefined ? `, default \`${JSON.stringify(schema.default)}\`` : "";
  return t + range + def;
}
