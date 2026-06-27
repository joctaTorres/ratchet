---
title: Run-state locus
sidebar_position: 3
---

# Run-state locus: batch vs. change-local

One step's run state — the append-only journal and the parked state — lives at a
**locus**. A batch step keeps it under `.ratchet/batches/<batch>/run/`; a
standalone change step driven with no manifest keeps it change-locally under
`.ratchet/changes/<change>/.run/`. The locus selects the directory only; the
journal and state file shapes are identical either way.

Defined in `src/core/batch/journal.ts` and `src/core/batch/engine/run-state.ts`.

## `RunLocus`

```ts
type RunLocus = { batch: string } | { change: string };
```

| Locus | Run directory |
|---|---|
| `{ batch }` | `.ratchet/batches/<batch>/run/` |
| `{ change }` | `.ratchet/changes/<change>/.run/` |

## Files at a locus

| File | Contents |
|---|---|
| `journal.jsonl` | Append-only log of agent reports (progress, blocker, needs-input, completion) and user answers/feedback. |
| `state.json` | Current parked steps (`blocked` / `awaiting-approval`) for resume. |

## Locus-aware functions

```ts
function runDirForLocus(projectRoot: string, locus: RunLocus): string;
function journalPathForLocus(projectRoot: string, locus: RunLocus): string;

function appendJournalForLocus(
  projectRoot: string,
  locus: RunLocus,
  entry: Omit<JournalEntry, 'at'> & { at?: string }
): JournalEntry;

function readJournalTolerantForLocus(
  projectRoot: string,
  locus: RunLocus
): JournalEntry[];

function readChangeJournalTolerantForLocus(
  projectRoot: string,
  locus: RunLocus,
  change: string
): JournalEntry[];
```

The batch-named helpers (`appendJournal(projectRoot, batch, …)`,
`readJournalTolerant`, `readChangeJournalTolerant`, …) delegate to the
`*ForLocus` functions with a `{ batch }` locus, so existing batch callers keep
their signatures and behavior.

## Engine behavior

`runChangeStep` resolves the locus from `ChangeStepContext.batch`: a `{ batch }`
locus when set, else `{ change }`. With no batch it also omits the
`RATCHET_BATCH_NAME` environment variable, so the runtime places its temp prompt
file under the change-local `.run/` rather than a batch run directory. See
[Change-step core](./change-step.md).
