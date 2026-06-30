---
title: ratchet list
sidebar_position: 12
---

# `ratchet list`

List active changes or feature-store specs. The default mode lists changes;
pass `--specs` to list capabilities from the feature store instead.

## Synopsis

```bash
ratchet list [--changes | --specs] [--sort <order>] [--json]
```

## Options

| Option | Argument | Description |
|---|---|---|
| `--changes` | | List active changes (default). |
| `--specs` | | List feature-store capabilities instead of changes. |
| `--sort` | `<order>` | Sort order: `recent` (default) or `name`. Ignored in `--specs` mode. |
| `--json` | | Output as JSON. Has no effect in `--specs` mode. |

## Behavior

### Changes mode (default)

Reads `.ratchet/changes/`, skipping the `archive` subdirectory. Each active
change is displayed with its name, task status, and last-modified time.

**Sort `recent` (default):** changes ordered by the most-recently-modified
file found anywhere inside each change directory (recursive). Changes with no
files fall back to the directory's own modification time.

**Sort `name`:** changes ordered alphabetically by change name.

If the changes directory does not exist, the command fails with an error asking
the caller to run `ratchet init` first. If the directory exists but contains no
active changes, the command prints `No active changes found.` and exits
successfully.

**Text output format:**

```
Changes:
  <name>    <status>      <last modified>
```

The `<status>` column contains one of:

| Value | Meaning |
|---|---|
| `No tasks` | No task list defined in `plan.md`. |
| `X/Y tasks` | `X` of `Y` tasks marked complete. |
| `✓ Complete` | All tasks marked complete. |

The `<last modified>` column contains a relative string: `just now`, `Xm ago`,
`Xh ago`, `Xd ago`, or a locale-formatted date string for changes older than
30 days.

**JSON output (`--json`):**

```json
{
  "changes": [
    {
      "name": "string",
      "completedTasks": 0,
      "totalTasks": 0,
      "lastModified": "ISO 8601 datetime",
      "status": "no-tasks | in-progress | complete"
    }
  ]
}
```

`status` values:

| Value | Condition |
|---|---|
| `"no-tasks"` | `totalTasks === 0` |
| `"in-progress"` | Some tasks remain. |
| `"complete"` | All tasks complete. |

An empty project produces `{ "changes": [] }`.

### Specs mode (`--specs`)

Reads `.feature` files under `.ratchet/features/` and groups them by the first
path segment (capability). Each capability is displayed with its name and total
feature count.

Specs are always sorted alphabetically by capability name regardless of
`--sort`. `--json` has no effect in this mode.

If the features directory is absent or contains no `.feature` files, the
command prints `No features found.` and exits successfully.

**Text output format:**

```
Features:
  <capability>    features <count>
```

## Cross-references

- [ratchet view](./view.md) — summary dashboard across changes and the feature store.
- [ratchet archive](./archive.md) — move a completed change to the archive.
