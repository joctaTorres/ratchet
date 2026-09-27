---
title: ratchet report
sidebar_position: 3.5
---

# `ratchet report`

The batch-less report channel for the headless workflow verbs
([`propose`](./propose.md), [`apply`](./apply.md), [`verify`](./verify.md)).
`report` appends one entry to the change-local run journal
`.ratchet/changes/<change>/.run/journal.jsonl` — the journal the engine snapshots
to map a standalone step's outcome. A standalone step's agent prompt names this
command as its report channel.

## Synopsis

```bash
ratchet report <change> <kind-flag> <message> [--json]
```

`<change>` is required: a kebab-case change name under `.ratchet/changes/`.
Exactly one kind flag must be provided.

## Options

| Option | Argument | Description |
|---|---|---|
| `--status` | `<message>` | Record routine progress (appends a `progress` journal entry). |
| `--blocker` | `<message>` | Raise a blocker (appends a `blocker` journal entry). |
| `--needs-input` | `<message>` | Request input (appends a `needs-input` journal entry). |
| `--complete` | `<message>` | Signal that the step produced its output (appends a `completion` journal entry). |
| `--json` | | Output the result as JSON (`{ kind, change }`). |

## Behavior

- Exactly one of `--status`, `--blocker`, `--needs-input`, or `--complete` must be
  present; zero or more than one fails with an error and writes nothing.
- `<change>` must be a valid kebab-case change name (`validateChangeName`); any
  other value — including a path such as `../../src` — fails before a path is
  built, and nothing is written.
- The change directory is not required to exist: a fresh `ratchet propose`
  spawns its agent before `.ratchet/changes/<change>/` is created, and a report
  posted then is appended to `.ratchet/changes/<change>/.run/journal.jsonl`.
- The entry is always written to the `{ change }` run-state locus. `report` never
  resolves a batch, so a batch in the project cannot capture the report.
- No parked state (`state.json`) is written: the engine maps a standalone step's
  outcome from the session's journal entries — `completion` → `advanced`,
  `blocker` / `needs-input` → `blocked`, and no completion → `blocked`
  ("without reporting completion").

| Kind flag | Journal entry appended |
|---|---|
| `--status` | `progress` |
| `--blocker` | `blocker` |
| `--needs-input` | `needs-input` |
| `--complete` | `completion` |

## Relation to `batch report`

A step driven by a batch reports through
[`ratchet batch report <batch> --change <change>`](./batch.md#batch-report), which
writes to the batch run journal and additionally supports `--answer`, `--reject`,
and `--awaiting-approval`. Those park/resume kinds have no standalone counterpart.

## Help group

`report` is listed under the `Workflow:` heading in `ratchet --help`, after
`verify` and before `batch`. See [Workflow help group](./workflow-help.md).
