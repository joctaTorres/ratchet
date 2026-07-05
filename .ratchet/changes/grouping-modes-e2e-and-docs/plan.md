# grouping-modes-e2e-and-docs

## Why

Phase 3 of the `per-stage-agents-and-prs` batch built stacked PR grouping across
five slices — the widened `prGrouping` enum (`grouping-mode-schema`), the pure
boundary policy (`boundary-detection`), the pure stacked-base policy
(`stacked-base-selection`), the instruction-fed base (`pr-instruction-stacked-base`),
the per-boundary engine spawn (`engine-spawn-at-boundaries`), and the `batch apply`
wiring (`apply-boundary-pr-wiring`). Each landed with unit/integration proof only
and deferred the phase's blackbox proof and the cross-cutting stacked-grouping
overview to this final change. This change ships the phase's E2E — `per-phase` and
`per-change` batches driven to completion through the built CLI against the fake
spawn seam — and completes the Reference/README documentation: the high-contrast
vertical Mermaid overview of stacked grouping, plus repair of two now-stale
"lands in a later Phase 3 change" passages the earlier slices left behind.

## What Changes

- Adds `test/cli-e2e/batch-pr-grouping-modes.test.ts` — the phase's blackbox
  proof-of-work — driving the compiled CLI via `runCLI` over isolated git-repo
  fixtures. It implements `features/stacked-pr-grouping/grouping-modes-e2e.feature`:
  - A completed two-phase batch configured `prGrouping: per-phase`, applied
    repeatedly until "nothing to do", records **exactly two** PR-open actions in
    boundary order: group `p1` from work branch `p1` to base `main`, group `p2`
    from work branch `p2` to base `p1`; run-state carries exactly one `pr`
    completion per group key (`pr:b:p1`, `pr:b:p2`); every apply exits 0.
  - A completed one-phase/two-change batch configured `prGrouping: per-change`
    yields one stacked PR per change: `c1` → `main`, `c2` → `c1`, keyed
    `pr:b:c1` / `pr:b:c2`.
  - A loop resumed after the first group's PR is open spawns a PR agent only for
    the remaining group — the first group's action stays recorded exactly once.
  - Re-running the fully-opened loop spawns nothing, changes no recorded action,
    and prints the unchanged `Nothing to do — all changes are done.` message.
  - The PR step's instructions delegate to `/rct:pr-open`, carry the group's own
    branch as work branch and the computed stacked base as base branch, and name
    the per-group report key `pr:b:<groupId>` (asserted via the sentinel the fake
    agent writes from the handed Input).
- Updates `docs/engine/agent-runtime.md`
  (implements `features/stacked-pr-grouping/stacked-grouping-docs.feature`):
  - Adds the deferred **stacked-grouping overview** — a high-contrast,
    vertically-oriented Mermaid diagram of stacked base selection across groups
    (batch base branch ← group 0's branch/PR ← group 1's branch/PR …) — leading
    the "Stacked PR base selection" section.
  - Removes the stale passage claiming "nothing yet calls `selectStackedBases`"
    and that the consumers "land in later Phase 3 changes"; replaces it with the
    shipped wiring (`runStackedPr` in `batch apply` composes the two policies).
- Updates `README.md`:
  - Replaces the stale "The `batch apply` CLI surfacing … lands in a later
    Phase 3 change" passage with the shipped behavior: `batch apply` drives one
    stacked PR per group boundary, one group per apply in boundary order,
    idempotently per group.
  - Embeds the same high-contrast vertical Mermaid overview of stacked grouping
    beside the existing PR-flow diagram, so the stacked-branch base rule is
    visible as a picture.
- Verifies `docs/configuration/config-yaml.md` and `docs/commands/doctor.md`
  remain accurate for the four `prGrouping` values (both already document them;
  no expected edit).

Not a breaking change: this slice adds one E2E test and documentation only — no
production source under `src/` changes.

## Design

**A blackbox E2E weighted to prove only what the top layer can (`testing`).** The
stacked machinery is already proven below: boundary ordering
(`test/batch-engine/boundary-detection.test.ts`), stacked-base mapping
(`test/batch-engine/*stacked*`), per-boundary spawn/idempotency/failure
(`test/batch-engine/engine-spawn-at-boundaries.test.ts`), and `batch apply`
selection/routing (`test/commands/batch/apply.test.ts`). Per the pyramid this E2E
does **not** re-test that logic; it proves the one thing only the top layer can —
that the user-visible `batch apply` loop, running the bundled engine over a real
git repo, opens one stacked PR per unit with the expected stacked base and never a
duplicate on resume. It lives under `test/cli-e2e/`, drives the compiled CLI via
`runCLI`, and asserts observable output, exit codes, and on-disk side effects (the
PR-open sentinel, run-state journal entries) — never internal state. Its file
header names `features/stacked-pr-grouping/grouping-modes-e2e.feature`
(traceability), mirroring `test/cli-e2e/batch-pr-whole-batch.test.ts`, whose
fixture/runtime path (bundled ReX-local runtime executing the
`RATCHET_BATCH_AGENT_CMD` override) this test reuses wholesale.

**The fake spawn seam is the existing `RATCHET_BATCH_AGENT_CMD` override — no new
production seam (`generalizable-defaults`, `testing`).** The engine already routes
every spawn through `bash -c "$RATCHET_BATCH_AGENT_CMD"`, feeding the step
instructions on stdin; `runCLI` forwards `env`. The fake PR agent is a POSIX shell
stand-in that acts only on instructions containing `/rct:pr-open` (any other spawn
is a no-op, so it cannot inflate spawn counts). It parses the `Work branch:` /
`Base branch:` Input lines and the per-group report key from the
`ratchet batch report … --change pr:<batch>:<groupId>` line the instructions
carry — so the sentinel line it appends (`pr-open group=<key> work=… base=…`)
proves delegation, the injected stacked base, and the per-group channel in one
observable artifact — then reports completion through that exact key. It shells
out to git only, invokes no forge CLI, and hard-codes no forge, mirroring the real
`/rct:pr-open` body's ecosystem-neutrality.

**Driving to completion: one group per apply, looped until done
(`delegated-lifecycle`).** `pickNextStep` surfaces the FIRST boundary whose
per-group key is unrecorded, so each apply opens exactly the next unopened group
in boundary order. The test loops `ratchet batch apply b` (bounded, e.g. ≤ groups
+ 1 iterations) until the output reads the done message, then asserts the ordered
sentinel lines. This loop *is* the resumed-loop proof: every invocation is a fresh
stateless process reading run-state, so "resume" and "next iteration" are the same
mechanism. The explicit resume scenario additionally checks the midpoint (after
one apply, exactly one action; the second apply touches only group 2), and the
no-duplicate scenario re-runs after full completion. Idempotency rides the
journal's per-group `completion` entries (`transition: 'pr'`, `change` =
`prJournalKey`), asserted via `readJournal` — the same run-state the CLI gate
reads, no bespoke lock.

**Fixtures reproduce a completed batch without a real agent lifecycle
(`testing`).** Each scenario builds an isolated root under
`fs.mkdtemp(os.tmpdir())`, removed in `afterAll`: a `BatchFixture`-seeded batch
(`writeBatch` with the mode in `settings`, `writeChangeWithTasks` all-done,
`completeVerify` per change, `passProof` per phase so `batch status` resolves
`done`), plus a real git repo with a semantic-commit history, an `origin` remote
whose HEAD names `main` (so `resolveBranches` derives the batch base branch from
the remote), and uncommitted work. Two shapes: per-phase uses phases
`p1`/`p2` × one change each; per-change uses one phase × changes `c1`/`c2`. The
default `groupBranch` resolver names each group's branch after its `groupId`, so
the expected work branches are exactly the phase/change names and the expected
bases are `main` then the previous group's id — the stacked-branch base rule
observed end to end. No test depends on another or on the real repository.

**Documentation completes the deferred stacked-grouping overview and repairs the
stale passages (`documentation`, mandatory).** The stacked modes are core batch
behavior, now fully shipped, so they earn exactly one overview diagram, embedded
in both surfaces:
- The diagram is an architecture-style stacking graph (matching "what does each
  PR target"), **vertically oriented** (`flowchart TD`/`graph TB`) as required
  for a core subject, with every `classDef` setting an explicit `color:` (light
  fill/dark text or dark fill/light text) and nodes prefixed with the semantic
  symbols already used across the project's diagrams (💾 base branch, 📝 group
  branch/work, 🌐 PR). It depicts `main` (batch base) ← group 0's branch with its
  PR targeting `main` ← group 1's branch with its PR targeting group 0's branch,
  annotated per-phase/per-change = group per phase/change. It must parse, render,
  and match `selectStackedBases` exactly.
- `docs/engine/agent-runtime.md` "Stacked PR base selection" gets the diagram and
  loses the unshipped-wiring paragraph (replaced with the shipped
  `runStackedPr`/`pickNextStep` composition, which the surrounding "PR step"
  section already describes accurately — keep terminology identical).
- `README.md` "PR grouping" loses the "lands in a later Phase 3 change" sentence,
  gains the one-group-per-apply / idempotent-per-group description and the same
  diagram. Prose stays austere Reference style; no tutorial or rationale.
- `docs/configuration/config-yaml.md` (already lists all four modes) and
  `docs/commands/doctor.md` (remote warning covers active modes via
  `isPrGroupingActive`) are re-checked for staleness; no edit is expected.

**Standards embedded.** `testing` (E2E at the right layer, fixture isolation,
feature-mirroring header, suite + coverage gate green), `documentation` (mandatory
docs task, README updated with the Reference entry, vertical high-contrast
diagram with `color:` on every classDef), `delegated-lifecycle` (the E2E asserts
the spawned step delegates to the shared `/rct:pr-open` command and re-authors
nothing), `instruction-fed-config` (the stacked base is asserted as data handed
through the instructions payload, not re-derived by the fake agent),
`generalizable-defaults` (the fake agent and the documented flow stay git-only and
forge-agnostic; no ratchet-toolchain literal ships into any generated surface —
this change ships none).

## Tasks

- [x] 1.1 (`testing`) Add `test/cli-e2e/batch-pr-grouping-modes.test.ts` with a
  header naming `features/stacked-pr-grouping/grouping-modes-e2e.feature`. Build
  the isolated fixture helper (mirroring `batch-pr-whole-batch.test.ts`): mkdtemp
  root cleaned in `afterAll`, git repo with semantic history + `origin` remote
  HEAD → `main`, and a `BatchFixture`-seeded completed batch parameterized by
  shape (`per-phase`: p1/p2 × one change; `per-change`: one phase × c1/c2) with
  verify completions and passing proofs.
- [x] 1.2 (`generalizable-defaults`, `delegated-lifecycle`) Add the forge-agnostic
  fake PR agent wired through `RATCHET_BATCH_AGENT_CMD`: act only on
  `/rct:pr-open` instructions; parse the handed work/base branch Input lines and
  the per-group report key; append one sentinel line
  (`group=<key> work=<work> base=<base>`); report completion via
  `ratchet batch report b --change <key> --complete …`. Git only, no forge CLI.
- [x] 2.1 (`testing`) Implement the per-phase scenario: loop `batch apply b` until
  the done message; assert exactly two ordered sentinel actions (`p1`→`main`,
  `p2`→`p1`), one journal `pr` completion each for `pr:b:p1` / `pr:b:p2`, exit 0
  throughout, and that the instructions delegated to `/rct:pr-open` with the
  stacked base as Input (via the sentinel's parsed values).
- [x] 2.2 (`testing`) Implement the per-change scenario: same loop; assert
  `c1`→`main` and `c2`→`c1` with keys `pr:b:c1` / `pr:b:c2`.
- [x] 2.3 (`testing`) Implement the resume and no-duplicate scenarios: after one
  apply, exactly one action (group 1 only); the next apply opens only group 2;
  one further apply on the fully-opened batch adds no action, spawns nothing, and
  prints `Nothing to do — all changes are done.` with exit 0; total journal `pr`
  completions equal the group count exactly.
- [x] 2.4 (`testing`) Run `pnpm test test/cli-e2e/batch-pr-grouping-modes.test.ts`
  to exit 0 (the phase's proof-of-work), then confirm the full suite and the
  coverage gate stay green at/above the enforced `COVERAGE_THRESHOLD` (test +
  docs only; coverage must not regress).
- [x] 3.1 (`documentation`, mandatory — `documentation` tag) In
  `docs/engine/agent-runtime.md`: add the high-contrast, vertically-oriented
  Mermaid stacked-grouping overview (batch base ← group 0 branch/PR ← group 1
  branch/PR; every `classDef` sets `color:`; semantic Unicode symbols) to the
  "Stacked PR base selection" section, and replace the stale "nothing yet calls
  `selectStackedBases` … land in later Phase 3 changes" paragraph with the
  shipped `batch apply`/`runStackedPr` wiring. Verify the diagram parses and
  matches `selectStackedBases`. Implements
  `features/stacked-pr-grouping/stacked-grouping-docs.feature`.
- [x] 3.2 (`documentation`, mandatory — `documentation` tag) In `README.md`:
  replace the stale "lands in a later Phase 3 change" passage with the shipped
  per-boundary behavior (one group per apply, boundary order, idempotent per
  group), state the stacked-branch base rule, and embed the same vertical
  high-contrast stacked-grouping diagram. Re-check
  `docs/configuration/config-yaml.md` and `docs/commands/doctor.md` for staleness
  (no edit expected). No described flag, default, or config key may be stale.
