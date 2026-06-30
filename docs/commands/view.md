---
title: ratchet view
sidebar_position: 13
---

# `ratchet view`

Render a formatted terminal dashboard summarising all active changes and
feature-store capabilities in the current project. The command prints to stdout
and exits; it does not maintain a live display or accept keyboard input.

## Synopsis

```bash
ratchet view
```

`view` takes no options or flags.

## Behavior

The dashboard is divided into the following sections, printed in order:

### Summary

Counts reported:

- **Features** — number of capability directories and total `.feature` files in
  the feature store.
- **Draft Changes** — changes with no tasks defined (omitted from summary line
  if count is zero).
- **Active Changes** — changes with tasks defined but not all complete.
- **Completed Changes** — changes where every task in `plan.md` is marked
  complete.
- **Task Progress** — aggregate `completed/total` across active changes and the
  overall percentage (omitted when no active changes have tasks).

### Draft Changes

Lists changes whose `plan.md` contains no task items. Sorted alphabetically by
change name.

### Active Changes

Lists changes with at least one task defined and at least one task not yet
complete. Each row displays the change name, a filled/empty progress bar, and
the completion percentage. Sorted by completion percentage ascending, then
alphabetically by name.

### Completed Changes

Lists changes where all tasks in `plan.md` are marked complete. Sorted
alphabetically by change name.

### Features

Lists feature-store capabilities (first path segment under `.ratchet/features/`)
with their feature count. Sorted by feature count descending.

## Source data

| Section | Source path |
|---|---|
| Changes | `.ratchet/changes/` (excludes the `archive` subdirectory) |
| Feature store | `.ratchet/features/**/*.feature` |

Task progress for each change is derived from checkbox items (`- [ ]` / `- [x]`)
in `.ratchet/changes/<change>/plan.md`.

If `.ratchet/` does not exist in the project root, the command exits with an
error.

## Cross-references

- [ratchet list](./list.md) — detailed tabular listing of changes or specs with
  sort and JSON options.
