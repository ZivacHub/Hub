Read when: wiring the server routes for the Settings page (step 21.4) or changing a setting definition.
# Phase 21, step 21.4: Settings (contract)

Ivan: "creating a settings would be really nice, where we could change the workflow on the go ... this is the default, but we could also change it off, so only on our prompts, for example, to save token usage if really needed." Background pictures default ON (D61).

## Files
- `tools/dashboard/lib/settings.mjs`: registry (`DEFINITIONS`, plain data) + store. `--selftest` = 16 checks.
- `tools/dashboard/public/settings.html|js|css`: the page `/settings.html`.
- `tools/dashboard/demo/settings.json`: sample answer of `GET /api/settings`.
- Hub defaults: `data/hub-defaults.json` (git-ignored; add to .gitignore if `data/` is not already there). Shape `{ "version": 1, "settings": { id: value }, "updated": iso }`.
- Project override, the ONLY file the Hub writes in a project: `<project folder>/.claude/hub-settings.json` = `{ "version": 1, "settings": { "<id>": "<value>" } }`. Only overrides; a missing key = use the default. Plain JSON, so the BUSNUS workflow can read it (step 21.5).

## Settings (v1)
| id | choices (value) | default |
|---|---|---|
| `reportAfterPhase` | `full` (full report with pictures), `short` (short summary only), `onRequest` (nothing until asked) | `short` |
| `backgroundPictures` | `always`, `onRequest`, `off` | `always` |

Add a setting = add one entry to `DEFINITIONS` (id, label, help, choices[{value,label,help}], default). API and page pick it up.

## Server wiring (for the server helper)
```js
import { makeSettings } from "./lib/settings.mjs";
const settings = makeSettings({
  dataFile: <Hub>/data/hub-defaults.json,
  projectNames: () => [names of folders directly inside the BUSNUS folder, skipping files and dot-folders],
  projectFolder: (name) => absolute path of that folder if (and only if) `name` is one of projectNames(), else null,
});
```
- `GET /api/settings` -> `settings.getAll()`:
  `{ definitions:[...], defaults:{id:value}, projects:[{ name, values:{ id:{ value, source:"default"|"project" } }, problem? }], problem? }`
  `problem` (a plain sentence) appears on a project whose settings file is unreadable (page shows it and disables that project's controls), or at top level when the Hub defaults file is unreadable. Demo mode (`--demo`): serve `demo/settings.json` and make `settings-set` change nothing on disk (return the sample with the change applied in memory, or refuse with a plain sentence).
- Guarded action in `POST /api/action` (same token header `X-Hub-Token` and `confirm:true` rule as the other actions). Body EXACTLY:
  `{ action:"settings-set", scope:"default"|"project", project?:<name>, id, value:<choice>|null, confirm:true }`
  `project` is required for scope `project` and absent for `default`; `value:null` only for scope `project` (remove the override). Maps to `settings.setDefault(id, value)` or `settings.setProject(project, id, value)`.
  Answer: `{ ok:true, settings:<fresh getAll()> }` or `{ ok:false, error:<plain sentence> }` (the module's own sentences are safe to show). No confirm question: reversible and instant. Log one line per change in the Hub's action log like other actions.
- `settings.mjs` writes only the two files above (atomic: temp file + rename in the same folder; a corrupt or unknown-version file is never overwritten; unknown keys kept).

## Page behaviour
- On load: only `GET /api/settings`. `GET /api/session` happens at the first change.
- A control change: optimistic, one POST, toast "Saved" or the error sentence with rollback. Changes are sent one after another.
- Per project, the first choice is "Use the default (<current default>)" = `value:null`. "Changed here" mark = `source:"project"`.
- Reloads when the tab comes back to the front.

## Tested 2026-11-24 (helper)
`node tools/dashboard/server.mjs --demo` on HUB_PORT=4795 plus a browser-side stand-in for the two missing routes (the demo server has none yet): request bodies exact, rollback on error, keyboard (arrows), console clean, light/dark/phone. Screenshots in `docs/screenshots/settings-{light,dark,phone}.png` (sample data).

## Wiring (server), as built 2026-11-24
- `GET /api/settings` -> the store's `getAll()` (shape above). POST/PUT/DELETE -> 405. Store = `makeSettings` on `data/hub-defaults.json`; project list = the names `/api/projects` uses; a project name only selects a folder out of that list (exact, case-sensitive match), never a path. In `--demo` the same store runs on an in-memory file system seeded from `demo/settings.json` (the answer also has `demo:true`): toggles work, nothing is written.
- `POST /api/action` body EXACTLY `{ action:"settings-set", scope:"default"|"project", project?, id, value, confirm:true }`: JSON content type, same Origin, `X-Hub-Token`, `confirm:true`, 2000-byte limit, like the other actions. `project` only with scope `project`; `value` is a text choice or `null` (null only for scope `project`). Answer `{ ok:true, settings:<fresh getAll()> }` or `{ ok:false, error }`, HTTP 200 (guard failures keep their 403/400/413/415).
- Error sentences: wrong shape (extra field, missing or non-text value, project on scope default, no project on scope project, other scope, non-text id): "The Hub can not change that setting. Look at the page again." From the store: "That setting does not exist." / "That choice is not one of the options for this setting." / "A default cannot be removed; pick one of the choices." / "That is not one of your BUSNUS projects." / "This project's settings file could not be read, ..." / "The Hub's defaults file could not be read, ..." / "The setting could not be saved. Nothing was changed."
- Log (logs/hub_actions.log): `settings-set <default|project> <setting id> <saved|removed|refused|refused: wrong request shape>`; never a project name or a value.

## Wiring (server): cost
- `GET /api/cost?project=<exact name>[&since=YYYY-MM-DD]` -> `makeCost(...).forProject(name, { since })`; without `project` -> `overview({ since })`. Unknown, wrong-case or path-like project -> 404 `{"error":"unknown project"}`. A `since` that is not a real YYYY-MM-DD date -> 400 `{"error":"bad since: use YYYY-MM-DD"}` (also on the overview). POST/PUT -> 405. `--demo` serves `demo/cost.json` (`projects[name]`, or `overview`; a name missing there is 404).
