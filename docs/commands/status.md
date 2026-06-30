---
title: ratchet status
sidebar_position: 14
---

# `ratchet status`

Display artifact completion status for a change. For each artifact in the
schema, `status` reports whether it is `done`, `ready` (all dependencies met),
or `blocked` (one or more dependencies unmet), along with a progress summary
and the artifact IDs required before the apply phase can start.

## Synopsis

```bash
ratchet status --change <id> [options]
```

`--change` is required when active changes exist.

## Options

| Option | Argument | Description |
|---|---|---|
| `--change` | `<id>` | Change name to show status for. Required when changes exist. |
| `--schema` | `<name>` | Schema override. Auto-detected from change metadata when omitted. |
| `--json` | | Output the structured status object as JSON. |

## Behavior

### Schema resolution

The schema is resolved in this order:

1. Explicit `--schema <name>` value.
2. Schema recorded in the change's `.ratchet.yaml` metadata file.
3. Built-in default (`spec-driven`).

### Artifact statuses

Each artifact in the schema is classified:

| Status | Indicator | Meaning |
|---|---|---|
| `done` | `[x]` | Output file(s) for this artifact exist on disk. |
| `ready` | `[ ]` | Not done; all required dependencies are done. |
| `blocked` | `[-]` | Not done; one or more required dependencies are not yet done. |

Blocked artifacts include the list of missing dependency IDs in the text
output: `(blocked by: <dep1>, <dep2>)`.

Artifacts are printed in schema build order (topological sort).

### Progress line

The text output includes a `Progress: N/M artifacts complete` line where `N`
is the count of `done` artifacts and `M` is the total artifact count.

When all artifacts are complete, a final `All artifacts complete!` message is
printed.

### Apply-requires

The JSON output includes an `applyRequires` field listing the artifact IDs
that must be `done` before the apply phase is available. This list comes from
`schema.apply.requires`; when the schema defines no `apply` block, all
artifact IDs are used as the default.

### No active changes

When no changes exist and `--change` is omitted, the command exits cleanly:

- Text output: `No active changes. Create one with: ratchet new change <name>`
- JSON output: `{ "changes": [], "message": "No active changes." }`

When changes exist but `--change` is omitted, the command fails with the list
of available change names.

## JSON output shape

`--json` prints a `ChangeStatus` object:

```json
{
  "changeName": "my-change",
  "schemaName": "spec-driven",
  "planningHome": { "kind": "repo" },
  "changeRoot": "/path/to/.ratchet/changes/my-change",
  "artifactPaths": {
    "proposal": {
      "outputPath": "proposal.md",
      "resolvedOutputPath": "/path/to/.ratchet/changes/my-change/proposal.md",
      "existingOutputPaths": ["/path/to/.ratchet/changes/my-change/proposal.md"]
    }
  },
  "isComplete": false,
  "applyRequires": ["proposal", "plan"],
  "nextSteps": ["..."],
  "actionContext": { "..." : "..." },
  "artifacts": [
    { "id": "proposal", "outputPath": "proposal.md", "status": "done" },
    { "id": "plan", "outputPath": "plan.md", "status": "ready" },
    { "id": "tasks", "outputPath": "tasks.md", "status": "blocked", "missingDeps": ["plan"] }
  ]
}
```

The `affectedAreas` field is present when workspace metadata is available.

## Related commands

- [`ratchet instructions`](./instructions.md) — generate enriched instructions for a specific artifact.
- [`ratchet verify`](./verify.md) — check that implementation matches change artifacts.
- [`ratchet new change`](./init.md) — create a new change.
