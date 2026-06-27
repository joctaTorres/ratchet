---
title: ratchet update
sidebar_position: 11
---

# `ratchet update`

Refreshes Ratchet skill files and slash commands for all configured tools in the project. Applies the current Ratchet version, active profile workflows, and delivery settings to all existing tool installations.

## Synopsis

```bash
ratchet update [path] [options]
```

`[path]` is the target project directory. Defaults to `.` (current directory).

## Options

| Option | Argument | Description |
|---|---|---|
| `--force` | | Force update even when tools are up to date. |

## Behavior

1. **Prerequisite check.** `update` requires `.ratchet/` to exist at the target path. If not found, the command exits with: `No Ratchet directory found. Run 'ratchet init' first.`

2. **Migration.** Before any update, `update` runs a one-time migration pass on existing projects to align them with the current profile system. Tool directories detected in the project are preserved.

3. **Profile and delivery resolution.** The active profile and delivery mode are read from the global config:
   - `core` profile (default): workflows `propose`, `apply`, `verify`, `archive`, `propose-standard`, `apply-batch`, `archive-batch`, `propose-batch`, `brainstorm`.
   - `custom` profile: only the workflows listed in the global config's `workflows` field.
   - `delivery` controls whether skills, commands, or both are written.

4. **Legacy artifact detection.** If legacy Ratchet artifacts are present:
   - Interactive mode: prompts to upgrade and clean up.
   - Non-interactive with `--force`: cleanup proceeds automatically; detected legacy tools are upgraded to the new skills system.
   - Non-interactive without `--force`: a warning is printed and the command continues without cleanup.

5. **Smart update detection.** Without `--force`, `update` computes which configured tools need refreshing:
   - **Version mismatch**: the `generatedBy` version embedded in existing skill files differs from the current Ratchet version.
   - **Config sync needed**: the installed set of workflows or delivery mode differs from what the active profile specifies.
   
   Tools that already match the current version and profile are skipped. The command reports which tools are being updated and which are already up to date.

6. **Force update.** With `--force`, all configured tools are updated regardless of their current version or sync state.

7. **Skill and command regeneration.** For each tool being updated:
   - Skill files under `<tool-dir>/skills/` are rewritten from current templates.
   - Slash-command files are rewritten via the tool's command adapter.
   - Skill directories and command files for workflows no longer in the active profile are removed.
   - If delivery changed to skills-only, existing command files are removed. If changed to commands-only, existing skill directories are removed.

8. **New tool detection.** After updating, `update` scans the project for tool directories that are not yet configured and prints a hint to run `ratchet init` to add them.

9. **Extra workflow note.** If any installed workflows are not part of the active profile, a note is displayed suggesting `ratchet config profile` to manage them.

## Output

`update` prints a per-tool spinner during generation and a summary on completion:

- Tools updated at the current version.
- Tools that failed, with error messages.
- Count of removed command files or skill directories when delivery changed.
- Count of removed files for deselected workflows.

When all tools are already up to date (without `--force`), the command reports the version and lists the up-to-date tools without writing any files.

## Notes

- Restart the IDE after `update` for slash command changes to take effect.
- `update` does not re-run tool selection or modify `.ratchet/config.yaml`. To change which tools are configured or to add new tools, use [`ratchet init`](./init.md).
- Use `--force` to unconditionally rewrite all skill and command files, for example after manually editing a skill file that should be reset to the managed template.

## See also

- [`ratchet init`](./init.md)
