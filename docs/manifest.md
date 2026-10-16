# The action manifest

The registry is the single source of truth. Two files are generated from it, and neither is ever edited by hand:

| File | Audience | Contents |
| --- | --- | --- |
| `generated/actions.json` | AI providers, scripts | Every action's id, title, description, category, kind, undoable flag, JSON Schema for params (draft 2020-12, input form), examples, default shortcuts, and availability in plain language. Also app conventions, concepts and workflows. |
| `generated/SKILL.md` | People and AI agents | A readable guide: what the app is, how to operate it, concepts, workflows, then every action grouped by category with a parameter table and examples. |

## How it is built

```
src/actions/*  ──►  ActionRegistry  ──►  buildManifest()  ──►  serializeManifest()  ──► actions.json
                                                 │
                                                 └──────────►  renderSkillMd()  ──────► SKILL.md
```

- `buildManifest` (`src/core/manifest/build-manifest.ts`) converts each Zod schema with `z.toJSONSchema(schema, { io: "input" })`. Fields with defaults are therefore optional, matching what a caller may send. Availability comes from each `when` clause's `describe` text.
- Hand-written prose (app description, concepts, workflows) lives in `src/core/manifest/concepts.ts`. It never restates per-action details such as shortcuts, which come from the registry.
- Output is deterministic: there are no timestamps and ordering is stable, so the files change only when the registry does.

## Commands

```bash
yarn manifest         # write generated/actions.json and generated/SKILL.md
yarn manifest:check   # exit 1 if they are out of date (also run by `yarn verify` and CI)
```

`yarn build` regenerates them first. A unit test (`tests/unit/manifest.test.ts`) also fails when the committed files are stale. A pull request that changes an action therefore shows the documentation change next to the code.

## At runtime

The same functions run in the browser:
- `app.manifest.export` (`{ "format": "json" | "skill" }`) downloads the live manifest.
- `app.ai.ask` sends `buildManifest(registry)` and `app.context.get` output to the AI provider.
- `window.photo.manifest()` returns it to scripts.
