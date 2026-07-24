# blackbox-proof-gate-e2e

## Why

The proof-of-work phase gate is now wired end to end in the engine (the boundary
proof runs and records in `apply.ts`, and `status.ts` / `pickNextStep` derive the
gate from the recorded verdict), but nothing drives the REAL `ratchet batch apply`
to prove it. This phase's own proof-of-work is `bash test/e2e/proof-of-work-gate.sh`,
which does not yet exist. This change authors that blackbox e2e and its committed
two-phase fixture batch so a failing phase-1 `hard-gate` proof is demonstrably
shown to block entry into phase 2, a passing proof unblocks it, and `warn` advances
while surfacing the failure — making `proofOfWork: hard-gate` provably real, not
declarative.

## What Changes

- Add a committed two-phase fixture batch manifest at
  `test/e2e/fixtures/proof-of-work-gate/batch.yaml`: phase `p1` carries a blackbox
  proof-of-work whose pass/fail is decided by an environment signal the e2e
  controls; phase `p2` holds one outstanding change.
- Add `test/e2e/proof-of-work-gate.sh`, a blackbox e2e mirroring the conventions of
  the existing `test/e2e/*.sh` smokes (notably `cli-smoke.sh`): it builds the
  package, drives the BUILT CLI as a child process against the fixture in fresh
  scratch project roots, and asserts purely on `--json` output and `batch status`.
  It writes a fail-closed machine-readable result to
  `test/e2e/.results/proof-of-work-gate.json` and exits 0 only when every scenario
  in `features/proof-of-work-gate/e2e-gate.feature` holds.
- Update Reference documentation to record the new e2e gate proof (per the
  `documentation` standard).

Implements `features/proof-of-work-gate/e2e-gate.feature`.

## Design

**Driving the real apply (blackbox).** Like `cli-smoke.sh`, the script never
imports internals: it runs `node "$ROOT/bin/ratchet.js" batch apply <name> --json`
and `... batch status <name> --json` as child processes with `cwd` set to a fresh
scratch project root, and asserts on exit code + parsed JSON. `NO_COLOR=1` is
exported so JSON message fields carry no ANSI escapes.

**Fixture shape.** The committed `batch.yaml` has two phases:
- `p1` — `proofOfWork: { kind: blackbox, run: <env-gated command>, pass: exit-zero }`,
  one change `first`.
- `p2` — one change `second` (no `after`), with its own placeholder proof-of-work.

The top-level `settings.proofOfWork` is `hard-gate` in the committed fixture; the
warn scenario flips just that one line in its scratch copy (a single `sed`), so a
single committed fixture exercises both policies.

**Making phase 1 done without an agent.** Per `status.ts`, an *archived* change is
done (`.ratchet/changes/archive/<name>/` exists). The script sets up each scratch
root by copying the fixture batch under `.ratchet/batches/<name>/batch.yaml` and
`mkdir -p .ratchet/changes/archive/first`. Phase 1 is then `done`; `second` has no
change dir so it is `ready`; phase 2 is ungated with no recorded proof, so the
boundary into `p2` triggers `p1`'s proof-of-work on the first apply. No real agent
is ever spawned — the script asserts at the proof-of-work / status / selection
layer, never driving apply into `p2`'s change.

**Env-gated proof command (generalizable-defaults).** The fixture proof-of-work
`run` is a neutral shell test keyed on an env var the script sets — e.g.
`test "${RATCHET_E2E_PROOF:-}" = pass` — NOT a ratchet-toolchain command like
`pnpm vitest`. `realBashRunner` spawns `bash -c <run>` inheriting the apply
process's environment, so exporting the var before invoking apply flips the
verdict. This keeps the fixture command project-agnostic per the
`generalizable-defaults` standard. (The script's own build step may use `pnpm`,
matching the sibling smokes — that is ratchet's own test infra, not a shipped
default.)

**The three scenarios** (each a fresh scratch root):
1. *hard-gate fail* — env unset/`fail`. `apply --json` #1 ⇒
   `state: "proof-of-work"`, `passed:false`, `gatePassed:false`, `policy:"hard-gate"`.
   `apply --json` #2 ⇒ `state: "nothing-ready"` whose `message` cites the failing
   proof ("blocked by … proof-of-work failed"). `status --json` ⇒ `phases[1].gated`
   is `true` and `phases[1].gatedBy` names `p1`'s failing proof — the clear report.
2. *hard-gate pass* — env `pass`. `apply --json` #1 ⇒ `passed:true`,
   `gatePassed:true`. `status --json` ⇒ `phases[1].gated` is `false` and `next.change`
   is `second` — the batch advances into phase 2.
3. *warn* — `settings.proofOfWork: warn`, env unset/`fail`. `apply --json` #1 ⇒
   `passed:false` but `gatePassed:true`, `policy:"warn"`; the human (non-JSON) apply
   line surfaces the failure as a warning (`⚠`), not a hard stop. `status --json` ⇒
   `phases[1].gated` is `false` — warn advances while surfacing the failure.

**Fail-closed result.** Mirroring `cli-smoke.sh`, the script writes
`{"ok":false,"checks":[]}` to `test/e2e/.results/proof-of-work-gate.json` BEFORE any
check runs (a crash leaves it red), accumulates a per-scenario `{name,passed}`
entry for each scenario, and atomically writes the real `{"ok":…,"checks":[…]}`
(temp file + `mv`) only after all scenarios complete. `set -euo pipefail`; each
scenario assertion runs under an `if` so every scenario is recorded even if one
fails. Exit 0 iff every scenario passed.

**JSON parsing.** Assertions read fields with `node -e`/`node -p` over the captured
stdout (already a dependency of the build) rather than fragile `grep`, e.g.
`node -e 'const j=JSON.parse(require("fs").readFileSync(0));process.exit(j.passed===false?0:1)'`.

**Documentation (documentation standard — mandatory task).** The proof-of-work gate
is core engine behavior already documented under `docs/engine/`. This change adds
the e2e that proves it, a user/maintainer-facing test surface, so the Reference
docs for the gate (`docs/engine/run-state.md` and/or the engine overview) gain a
note that `test/e2e/proof-of-work-gate.sh` is the blackbox proof of the gate, and
`README.md` is checked/updated if it enumerates the e2e suite. No CLI command, flag,
or config key changes, so no new diagram is required — the existing gate diagram
stays accurate.

## Tasks

- [x] 1.1 Add the committed two-phase fixture batch at
  `test/e2e/fixtures/proof-of-work-gate/batch.yaml` — `p1` with an env-gated
  blackbox `proofOfWork` (neutral command per `generalizable-defaults`) and change
  `first`; `p2` with change `second`; top-level `settings.proofOfWork: hard-gate`.
- [x] 1.2 Write `test/e2e/proof-of-work-gate.sh` skeleton mirroring `cli-smoke.sh`:
  `set -euo pipefail`, `NO_COLOR=1`, resolve `ROOT`, build the package, lay down the
  fail-closed `test/e2e/.results/proof-of-work-gate.json` placeholder, and provide a
  helper that scaffolds a fresh scratch project root (copy fixture batch, archive
  `first`).
- [x] 2.1 Implement scenario 1 (hard-gate fail): drive two applies + status, assert
  recorded `passed:false`/`gatePassed:false`, `nothing-ready` citing the failing
  proof, and `phases[1].gated` with a `gatedBy` report naming `p1`.
- [x] 2.2 Implement scenario 2 (hard-gate pass): export the pass env, assert
  recorded `passed:true`/`gatePassed:true`, `phases[1].gated:false`, and `next.change`
  is `second`.
- [x] 2.3 Implement scenario 3 (warn): flip the scratch copy's
  `settings.proofOfWork` to `warn`, assert recorded `passed:false`/`gatePassed:true`,
  the human apply line surfaces a warning, and `phases[1].gated:false`.
- [x] 2.4 Accumulate per-scenario results, write the real result atomically, and
  exit 0 iff every scenario passed.
- [x] 3.1 Run `bash test/e2e/proof-of-work-gate.sh` and confirm it exits 0 (the
  phase proof-of-work) against the real built CLI.
- [x] 4.1 (documentation — mandatory, per the `documentation` standard) Update the
  proof-of-work gate Reference doc under `docs/engine/` (e.g. `run-state.md`) to
  cite `test/e2e/proof-of-work-gate.sh` as the blackbox proof of the gate, and
  update `README.md` if it enumerates the e2e suite. Keep the existing gate diagram
  accurate.
