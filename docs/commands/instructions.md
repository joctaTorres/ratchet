---
title: ratchet instructions
sidebar_position: 15
---

# `ratchet instructions`

Output enriched instructions for creating an artifact or for applying tasks.
The positional `[artifact]` argument selects which artifact's instructions to
produce. The special value `apply` routes to a separate apply-instructions
path that reads apply-phase configuration from the schema.

## Synopsis

```bash
ratchet instructions [artifact] --change <id> [options]
ratchet instructions apply    --change <id> [options]
```

`--change` is required. `[artifact]` must be a valid artifact ID from the
change's schema, or the literal string `apply`.

## Options

| Option | Argument | Description |
|---|---|---|
| `--change` | `<id>` | Change name. Required. |
| `--schema` | `<name>` | Schema override. Auto-detected from change metadata when omitted. |
| `--json` | | Output the structured instructions object as JSON. |

## Behavior

### Schema resolution

The schema is resolved in this order:

1. Explicit `--schema <name>` value.
2. Schema recorded in the change's `.ratchet.yaml` metadata file.
3. Built-in default (`spec-driven`).

### Artifact instructions (default path)

When `[artifact]` is a schema artifact ID, the command generates instructions
for creating that artifact. If `[artifact]` is omitted, the command fails with
the list of valid artifact IDs for the change.

The text output is a structured XML-like block:

| Section | Content |
|---|---|
| `<artifact>` | Opening tag with `id`, `change`, and `schema` attributes. |
| `<warning>` | Present when one or more dependencies are not yet `done`. Lists missing dependency IDs. |
| `<task>` | Directive to create the artifact: artifact ID, change name, and artifact description. |
| `<project_context>` | Background information from the project's `config.yaml` `context` field. Not to be included in the artifact output. |
| `<rules>` | Per-artifact rules from `config.yaml`. Not to be included in the artifact output. |
| `<standards>` | Active project standards from the standards library. Applicable standards should be embedded into the artifact. |
| `<dependencies>` | Each dependency artifact's absolute path and description, with a `status` attribute (`done` or `missing`). |
| `<output>` | Absolute path to write the artifact file to. |
| `<instruction>` | Schema-level guidance for creating this artifact (from the artifact's `instruction` field). |
| `<template>` | Full template content from the schema's `templates/` directory. Use as the output structure. |
| `<success_criteria>` | Placeholder for schema-defined validation rules. |
| `<unlocks>` | Artifact IDs that become available after this artifact is complete. |

#### Dependency tracking

Each artifact in the schema declares `requires: [...]`. A dependency is `done`
when its output file exists on disk. If any dependency is not done, the
`<warning>` section is emitted and the dependency entry carries
`status="missing"`.

The `<unlocks>` section lists all other artifacts whose `requires` list
includes the current artifact ID (sorted alphabetically).

### Apply instructions (`apply` argument)

When the positional argument is `apply`, the command reads the schema's `apply`
block and produces task-tracking instructions for the implementation phase.

#### Apply state

Apply instructions have one of three states:

| State | Condition |
|---|---|
| `blocked` | One or more artifacts listed in `schema.apply.requires` are not done; or the tracking file configured in `schema.apply.tracks` is missing or empty. |
| `ready` | All required artifacts are done and (if a tracking file is configured) it contains tasks with at least one remaining. |
| `all_done` | All required artifacts are done, a tracking file is configured, and all tasks in it are checked. |

When the schema defines no `apply` block, all artifact IDs are treated as
required, and no tracking file is expected (`state` becomes `ready` once all
artifacts are done).

#### Tracking file

`schema.apply.tracks` is a path relative to the change directory pointing to a
Markdown file that contains checkbox tasks (lines of the form `- [ ] ...` or
`- [x] ...`). The command parses these checkboxes to compute `progress` and
the `tasks` list. A custom instruction for the apply phase may be set in
`schema.apply.instruction`; when absent, a default instruction is used.

#### Apply text output

The text output is formatted as Markdown sections:

- `## Apply: <changeName>` — heading with schema name.
- `### Blocked` — present when `state` is `blocked`; lists missing artifacts.
- `### Context Files` — all existing artifact output files keyed by artifact ID.
- `### Progress` — `N/M complete` counter (only when a tracking file provides tasks).
- `### Tasks` — checkbox list from the tracking file.
- `### Instruction` — actionable guidance derived from state and schema configuration.

## JSON output shapes

### Artifact instructions (`--json`)

`--json` prints an `ArtifactInstructions` object:

```json
{
  "changeName": "my-change",
  "artifactId": "proposal",
  "schemaName": "spec-driven",
  "changeDir": "/path/to/.ratchet/changes/my-change",
  "outputPath": "proposal.md",
  "resolvedOutputPath": "/path/to/.ratchet/changes/my-change/proposal.md",
  "existingOutputPaths": [],
  "description": "High-level proposal document",
  "instruction": "Write a concise proposal...",
  "context": "This project uses TypeScript...",
  "rules": ["Do not include implementation details"],
  "template": "# Proposal\n...",
  "standards": [{ "name": "documentation", "tag": "v1", "fileName": "documentation.md", "content": "..." }],
  "dependencies": [
    { "id": "brief", "done": true, "path": "brief.md", "description": "..." }
  ],
  "unlocks": ["plan"]
}
```

`context`, `rules`, and `standards` are `null` when the project has no
configuration or standards library.

### Apply instructions (`apply --json`)

`--json` prints an `ApplyInstructions` object:

```json
{
  "changeName": "my-change",
  "changeDir": "/path/to/.ratchet/changes/my-change",
  "schemaName": "spec-driven",
  "contextFiles": {
    "proposal": ["/path/to/.ratchet/changes/my-change/proposal.md"],
    "plan": ["/path/to/.ratchet/changes/my-change/plan.md"]
  },
  "progress": { "total": 5, "complete": 2, "remaining": 3 },
  "tasks": [
    { "id": "1", "description": "Implement auth module", "done": true },
    { "id": "2", "description": "Add unit tests", "done": false }
  ],
  "state": "ready",
  "missingArtifacts": [],
  "instruction": "Read context files, work through pending tasks..."
}
```

`missingArtifacts` is omitted when empty. `progress` and `tasks` are empty
when the schema defines no `tracks` file.

## Related commands

- [`ratchet status`](./status.md) — show artifact completion status for a change.
- [`ratchet verify`](./verify.md) — verify implementation matches change artifacts.
