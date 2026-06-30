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
| `journal.jsonl` | Append-only log of agent reports (progress, blocker, needs-input, completion), user answers/feedback, and phase **proof-of-work** verdicts. |
| `state.json` | Current parked steps (`blocked` / `awaiting-approval`) for resume. |

A `JournalEntry` has a `kind` of `progress`, `blocker`, `needs-input`,
`completion`, `answer`, `reject`, `proof-of-work`, or
`proof-of-work-invalidated`. A `proof-of-work` entry additionally carries a
`proof` field holding the recorded verdict; a `proof-of-work-invalidated` entry
is an append-only marker (carrying only the phase, via its key) that supersedes
the latest recorded proof for that phase so the boundary re-runs.

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

## Proof-of-work records

A phase's proof-of-work verdict is journaled durably at the phase boundary by
`batch apply` (see [Phase gates and
proof-of-work](./overview.md#phase-gates-and-proof-of-work)), so the verdict
survives across the stateless single-step apply invocations. The recorded verdict
**drives the next phase's gate**: `computeBatchStatus` blocks the following phase
when a phase's recorded `hard-gate` proof failed (`gatePassed: false`), and opens
it once the recording passes. The record is a `proof-of-work` journal entry whose
`proof` field holds a `ProofOfWorkRecord`:

```ts
interface ProofOfWorkRecord {
  phase: string;       // the phase whose proof-of-work ran
  passed: boolean;     // the proof command/judge passed
  gatePassed: boolean; // policy lets the phase complete (passed, or policy is warn)
  policy: ProofOfWorkPolicy; // 'hard-gate' | 'warn'
  reason: string;      // machine-readable pass/fail reason
  detail: string;      // human-readable explanation of the verdict
}
```

The entry is keyed (its `change` field) by `proofOfWorkJournalKey(phase)`, which
returns `proof-of-work:<phase>` — distinct from a decomposition entry's key (the
bare phase name) so the two never collide.

```ts
function proofOfWorkJournalKey(phase: string): string; // `proof-of-work:${phase}`

// Writer: append a phase's verdict to the batch run journal. IDEMPOTENT per
// boundary: if the phase already has a current (un-invalidated) record, the call
// is a no-op and returns `undefined`. The boundary proof runs outside the batch
// lock, so two concurrent applies could each reach the recorder for the same
// boundary; this guard preserves "at most once per boundary". A fresh record is
// accepted again only after a `proof-of-work-invalidated` marker (the
// `batch rerun-proof` path) drops the phase from the fold.
function recordProofOfWork(
  projectRoot: string,
  batch: string,
  phase: string,
  record: ProofOfWorkRecord
): JournalEntry | undefined;

// Writer: append a superseding invalidation marker for a phase (append-only;
// the original proof-of-work entry is left in place). Backs `batch rerun-proof`.
function recordProofOfWorkInvalidation(
  projectRoot: string,
  batch: string,
  phase: string
): JournalEntry;

// Pure reader: fold any journal entry list to the latest record per phase.
// A `proof-of-work-invalidated` marker deletes its phase from the map; a later
// real `proof-of-work` record for the same phase re-adds it.
function proofRecordsFromEntries(
  entries: JournalEntry[]
): Map<string, ProofOfWorkRecord>;

// Readers: latest-wins, derived from the append-only (oldest-first) journal.
function readProofOfWorkByPhase(
  projectRoot: string,
  batch: string
): Map<string, ProofOfWorkRecord>;

function readLatestProofOfWork(
  projectRoot: string,
  batch: string,
  phase: string
): ProofOfWorkRecord | undefined;
```

`proofRecordsFromEntries` folds a journal entry list to the latest record per
phase (latest append wins; non-proof entries ignored). `readProofOfWorkByPhase`
delegates to it over the full run journal, and `computeBatchStatus` calls it over
the same `journal` it already receives — so the phase gate derives from those
entries with no extra disk read, and the on-disk and in-memory derivations stay
identical. `readLatestProofOfWork` returns the latest record for one phase, or
`undefined` when none has been recorded. `batch apply` builds its "already
recorded" phase set from `readProofOfWorkByPhase` so the boundary proof runs at
most once per boundary, and reads the same records to cite a failing proof that is
holding a later phase shut.

### Superseding a recorded proof (re-run)

A recorded verdict is durable, but it can be **superseded** without rewriting the
append-only journal. The `ratchet batch rerun-proof [name] --phase <phase>` verb
(see [commands: `batch rerun-proof`](../commands/batch.md#batch-rerun-proof))
calls `recordProofOfWorkInvalidation`, which appends a
`proof-of-work-invalidated` marker keyed by the same `proof-of-work:<phase>` key.
Because the fold is order-sensitive — `proof-of-work` **adds** a phase, the marker
**deletes** it, and a newer `proof-of-work` re-adds it — the phase simply
disappears from the current record map after a marker. Both consumers therefore
re-open by construction: `computeBatchStatus` sees no recorded verdict for the
phase (gate **re-opens**) and `pickNextStep` re-includes the phase's boundary
proof-of-work step (it is no longer in the "already recorded" set), so the next
`batch apply` re-runs the phase's configured `proofOfWork.run` and records a fresh
verdict. The original `proof-of-work` entry is never deleted — the audit trail of
the prior verdict is preserved. When no proof is recorded for the phase, the verb
is a no-op and appends nothing.

### Blackbox proof of the gate

`test/e2e/proof-of-work-gate.sh` is the end-to-end proof that this gate is real,
not merely modeled. It builds the package and drives the BUILT CLI as a child
process (`node bin/ratchet.js batch apply|status … --json`) against the committed
two-phase fixture `test/e2e/fixtures/proof-of-work-gate/batch.yaml` in fresh
scratch project roots. The fixture's phase-1 proof-of-work passes or fails purely
on the `RATCHET_E2E_PROOF` environment variable the script sets — a neutral
shell test, so no agent is ever spawned — and the script asserts on the `--json`
output of `batch apply` and `batch status` that a failing `hard-gate` proof blocks
entry into phase 2 with a report naming the failing proof, that a passing proof
opens the gate (next step points at phase 2's change), and that `warn` advances
while surfacing the failure (`gatePassed: true`, a `⚠` apply line). It writes a
fail-closed machine-readable result to `test/e2e/.results/proof-of-work-gate.json`
and exits 0 only when every scenario holds.

## Engine behavior

`runChangeStep` resolves the locus from `ChangeStepContext.batch`: a `{ batch }`
locus when set, else `{ change }`. With no batch it also omits the
`RATCHET_BATCH_NAME` environment variable, so the runtime places its temp prompt
file under the change-local `.run/` rather than a batch run directory. See
[Change-step core](./change-step.md).
