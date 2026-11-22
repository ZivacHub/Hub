Read when: building or changing the slash-command list of the Hub chat box (Phase 19)

# Slash commands in the Hub chat box: the list (contract)

Goal: type "/" in the Hub chat box and see a list of commands, like in the Claude app. In a windowless Hub chat (`claude -p`) the commands that work are the skills and custom commands (CLAUDE_CONTROL.md row T11: "/info" ran). This file defines the list the page gets. The page (dropdown) is a separate step.

## Route

`GET /api/commands?project=<project name>` (read only; POST/PUT -> 405).
- No `project`: user commands only.
- `project` = exact name of a known project (same check as `/api/project`, `resolveName`): user commands plus that project's own. Anything else (unknown, wrong case, path tricks, empty value) -> 404 `{"error":"unknown project"}`. The name is never used as a path; the folder comes from the project registry.
- Cached 30 seconds per project name (in `lib/commands.mjs`).
- `--demo`: a fixed sample list (pickup, handoff, plan, overview, delegate, docs, info), source "user".

## Shape

```json
{ "commands": [
  { "name": "pickup", "description": "Continue a project in a new chat without losing the thread.", "source": "user" },
  { "name": "deploy", "description": "Deploy it.", "source": "project", "hint": "[env]" }
] }
```
- `name`: what is typed after "/" (letters, digits, `_ : . -`, at most 64, no spaces or slashes). Sorted by name (English order), at most 300 entries.
- `description`: first line only, at most 180 characters (cut with "...").
- `source`: `"user"` or `"project"` (`"plugin"` is reserved, not produced, see below).
- `hint`: only when the file has `argument-hint` (at most 80 characters).

## Sources

1. User skills: `%USERPROFILE%\.claude\skills\*\SKILL.md` (frontmatter `name`, `description`).
2. Project skills: `<project folder>\.claude\skills\*\SKILL.md`.
3. Project commands: `<project folder>\.claude\commands\*.md` (name = file name without `.md`; description from frontmatter `description`, else the first non-empty line).
A project entry replaces a user entry with the same name.

## What is skipped or tolerated

- Skipped: `user-invocable: false`; a frontmatter `name` that is not a typeable name; folders without `SKILL.md`; files that are not `.md` in commands; unreadable files.
- Tolerated: no or never-closed frontmatter (listed by folder or file name, description from the first line), Windows line ends, quoted values, `>` / `|` block descriptions, huge descriptions (clipped).
- Only the first 8 KB of each file is read; the body is used only as a fallback for a missing description.
- Plugins are NOT read: on this PC `settings.json` has no `enabledPlugins` and `~/.claude/plugins` has no installed-plugins list, so there is no reliable way to know which plugin skills are on. Add later when a reliable list exists.
- Built-in commands of the app (/compact, /clear, /model, /config and so on) are NOT in the list: they are not files, the app handles them itself, and a windowless `claude -p` chat does not run them. They cannot be read from disk, so listing them would be a guess.

## Tests

`node tools/dashboard/lib/commands.mjs --selftest` (fake folders in a temp dir) and the `/api/commands` lines of `node tools/dashboard/server.mjs --selftest` (no project, known project, unknown 404, path tricks, 405, demo).
