---
title: ratchet archive
sidebar_position: 18
---

# `ratchet archive`

Move a completed change into the archive and synchronize its artifacts into the
permanent feature store. `archive` is the terminal step in the single-change
workflow; after it runs the change directory no longer exists under
`.ratchet/changes/`.

## Synopsis

```bash
ratchet archive [change-name] [options]
```

`[change-name]` is optional. When omitted, an interactive selector lists every
active change under `.ratchet/changes/` (excluding the `archive/` subdirectory)
together with task-progress indicators, and the user selects one.

## Options

| Option | Argument | Description |
|---|---|---|
| `-y, --yes` | | Skip all confirmation prompts; accept defaults automatically. |
| `--skip-features` | | Skip the feature store update step. No `.feature` files are copied and no standard links are materialized. |
| `--no-validate` | | Skip pre-archive validation. Not recommended; requires an additional confirmation prompt unless `-y` is also set. |
| `--accept-removed-scenarios` | | Allow feature-store overwrites that drop scenarios. By default the archive refuses such overwrites and lists each lost scenario; this flag accepts the removal. |

## Behavior

Steps execute in the order listed below. Any step that fails aborts the command;
the change directory is left untouched unless the failure occurs during the final
move.

### 1. Change resolution

If `[change-name]` is supplied, `archive` verifies that
`.ratchet/changes/<change-name>/` exists and is a directory.

If `[change-name]` is omitted, an interactive `select` prompt is presented.
Each choice shows the change name and its task-completion status (e.g.
`3/4 tasks`). Cancelling the prompt (Ctrl-C) exits without error.

### 2. Validation

Skipped entirely when `--no-validate` is set.

When `--no-validate` is set, a timestamped warning is printed. Without `-y` a
confirmation prompt (default: **No**) must be answered affirmatively to proceed;
with `-y` the warning is printed and execution continues automatically.

When validation runs, three checks are performed:

| Check | Scope | Blocking |
|---|---|---|
| Plan validation | `<changeDir>/plan.md` | No — warnings printed but archive continues |
| Feature-file validation | `<changeDir>/features/**` | Yes — any ERROR halts archive |
| Standards-link validation | `<changeDir>/` declared tags | Yes — any ERROR halts archive |

If blocking errors are found, the command prints them and exits, directing the
user to fix the errors or pass `--no-validate`.

### 3. Task-progress check

Task completion is read from the change's task list. The current status is
printed (e.g. `3/4 tasks completed`).

If any tasks are incomplete and `-y` is not set, a confirmation prompt (default:
**No**) asks whether to continue. With `-y` the warning is printed and execution
continues.

### 4. Feature store update

Skipped when `--skip-features` is set; a notice is printed.

Without `-y`, a confirmation prompt (default: **Yes**) asks whether to proceed
with the feature store update.

When the update runs:

- Every `*.feature` file under `<changeDir>/features/` is copied to
  `.ratchet/features/<store-relative-path>`, adding new files and overwriting
  existing ones at the same store-relative path.
- If `<changeDir>/features/.deleted` exists, each non-blank, non-comment line is
  treated as a store-relative path and the corresponding file is removed from
  `.ratchet/features/`.
- Results are printed per capability (first path segment of the store-relative
  path): counts of files added, overwritten, deleted, and unchanged, followed by
  aggregate totals.

After the feature files are applied, standard links are materialized for any
standards declared in the change:

- Per-capability `.ratchet.yaml` sidecar files under `.ratchet/features/` are
  updated with forward links to the relevant standards.
- `## Implemented by` reverse-link blocks inside the standard documents are
  regenerated to include this change's capabilities.

A change that declares no standards produces no sidecar or reverse-link output
from this step.

#### Scenario-loss guard

Before any store write, every file the change would overwrite (present in the
store, byte-different, and not listed in the change's `features/.deleted`
tombstone) is checked for scenario loss: the `Scenario` / `Scenario Outline`
(and `Scenario Template`) names of the store copy are compared against the
change copy. If any store scenario name is missing from the change's version —
including a rename, which counts as a loss of the old name — the command
refuses: it prints one error grouping each lost scenario name under its
store-relative file and aborts before the first copy or delete, so the store
is left untouched and the change is not moved into the archive.

The guard trips under `-y` as well; no confirmation prompt can approve a loss.
The intentional-removal routes are:

- `--accept-removed-scenarios` — accept the removal and apply the overwrite.
- A `features/.deleted` tombstone entry — remove the whole store file (no
  scenario check runs for tombstoned files).

New store files (fresh capabilities), byte-identical files, and overwrites
that keep every store scenario (supersets) apply normally without tripping the
guard. Because the comparison runs against the live store at archive time, a
second change that overwrites a store file without the scenarios an earlier
change just archived is refused the same way.

### 5. Move to archive

The change directory is moved to:

```
.ratchet/changes/archive/<YYYY-MM-DD>-<change-name>/
```

where `<YYYY-MM-DD>` is the current local date. The `archive/` subdirectory is
created if it does not yet exist.

If the destination path already exists, the command fails with an error before
moving anything.

On completion, the command prints:

```
Change '<change-name>' archived as '<YYYY-MM-DD>-<change-name>'.
```

## Exit behavior

The command exits non-zero and prints an error message if:

- No `.ratchet/changes/` directory exists (run `ratchet init` first).
- The named change does not exist.
- Blocking validation errors are present and `--no-validate` was not passed.
- The computed archive destination already exists.
- Any filesystem operation fails during the move.
- A feature-store overwrite would drop store scenarios and
  `--accept-removed-scenarios` was not passed (the error lists each lost
  scenario name grouped by store file; the store is left unchanged and the
  change is not moved).

## See also

- [ratchet verify](./verify.md) — verify implementation before archiving
- [ratchet apply](./apply.md) — implement tasks in a change
