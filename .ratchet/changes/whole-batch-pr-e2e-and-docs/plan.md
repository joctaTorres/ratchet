# whole-batch-pr-e2e-and-docs

## Why

Phase 2 of the `per-stage-agents-and-prs` batch built the whole-batch PR flow
across five slices — the `prGrouping` config and the `pr` stage
(`pr-grouping-config`), the shared forge-agnostic `/rct:pr-open` instruction
(`pr-open-instruction`), the engine `runPrStep` spawn (`pr-spawn-at-completion`),
the `batch apply` wiring (`pr-step-apply-wiring`), and the doctor remote warning
(`doctor-pr-remote-warning`). Each landed with unit/integration proof only and
deliberately deferred the phase's blackbox proof and the cross-cutting PR-flow
overview to this final change. This change ships the phase's E2E — a
`prGrouping: whole-batch` batch driven to completion through the built CLI against
the fake spawn seam — and completes the Reference/README documentation with the
one thing every prior slice postponed: the high-contrast vertical Mermaid overview
of the whole-batch PR flow.

## What Changes

- Adds `test/cli-e2e/batch-pr-whole-batch.test.ts` — the phase's blackbox
  proof-of-work — driving the built `bin/ratchet.js` via `runCLI` over an isolated
  git-repo fixture. It implements
  `features/whole-batch-pr/completion-e2e.feature`:
  - A completed single-phase batch configured `prGrouping: whole-batch`, run with
    `batch apply` against the fake spawn seam, spawns the PR agent **exactly once**
    for the `pr` stage, records **exactly one** PR-open action, and the commit the
    fake PR agent authors on the work branch follows the repository's semantic /
    Conventional-Commit `git log` style; the command exits 0.
  - `prGrouping: off` and an unset `prGrouping` each spawn **no** PR agent, record
    no PR-open action, and print the unchanged `Nothing to do — all changes are
    done.` terminal message.
  - A second `batch apply` on the completed batch is idempotent — no second spawn,
    still exactly one PR-open action total, the unchanged done message (PR state
    read from run-state).
  - A fake PR agent that exits non-zero without reporting a completion surfaces the
    PR step as a **reported failure**, records no `pr` completion in run-state, and
    leaves a retry possible.
- Adds the deferred **whole-batch PR-flow overview** to
  `docs/engine/agent-runtime.md`: an `## Overview` lead for the "Completion PR
  step" section whose first artifact is a high-contrast, vertically-oriented
  Mermaid flowchart of the flow (batch completion → CLI gate on `prGrouping` →
  spawned `pr`-stage agent delegating to `/rct:pr-open` → commit in git-log style →
  single PR → run-state record). Implements
  `features/whole-batch-pr/pr-flow-docs.feature`.
- Updates `README.md` to document the whole-batch PR flow for users: the
  `prGrouping` setting (`off` default / `whole-batch`), the `pr` fourth routable
  agent stage, and the same high-contrast vertical Mermaid overview of the flow.

Not a breaking change: this slice adds one E2E test and documentation only — no
production source under `src/` changes. The `off`-default behavior it asserts is
the existing behavior; the docs describe the flow already shipped by the prior
four slices.

## Design

**A blackbox E2E that drives the real binary, weighted to prove only what the
lower layers cannot (`testing`).** The whole-batch PR flow is already proven at the
unit layer (`runPrStep` in `pr-spawn-at-completion`, `pickNextStep` in
`pr-step-apply-wiring`) and the integration layer (`batch apply` routing in
`test/commands/batch/apply.test.ts`). Per the pyramid this E2E does **not**
re-test that logic; it exists to prove the one thing only the top layer can — that
the *user-visible* `batch apply` surface, running the bundled engine end-to-end
over a real git repo, opens exactly one PR at completion and nothing when grouping
is off. It lives under `test/cli-e2e/`, drives the compiled CLI via the existing
`runCLI` helper, and asserts on observable output, exit codes, and real on-disk
side effects (a git commit, a PR-open sentinel) — never on internal state.

**The fake spawn seam is the existing `RATCHET_BATCH_AGENT_CMD` override, not new
code (`generalizable-defaults`, `testing`).** `buildSpawnRequest` already routes
every spawn through a `bash -c` command when `RATCHET_BATCH_AGENT_CMD` is set,
standing in for the coding-agent binary and receiving the step instructions on
stdin (the same seam `batch-bundled-engine.test.ts` and the eval judge rely on).
`runCLI` forwards `env`, so the E2E sets this var to a small POSIX shell stand-in.
No production seam is added for the test. The fake PR agent is deliberately
forge-agnostic: it shells out to **git only** and writes a plain sentinel file for
the "PR opened" action — it invokes no `gh`/`glab` and hard-codes no forge, mirror
of the ecosystem-neutrality the real `/rct:pr-open` body preserves.

**The fake PR agent mirrors the `/rct:pr-open` contract so the semantic-commit
assertion is meaningful (`delegated-lifecycle`, `instruction-fed-config`).** The
stand-in reads its stdin instructions and branches on content: only the PR step's
prompt contains `/rct:pr-open`, so a non-PR spawn (should any occur) is a no-op
that fails the "spawned exactly once" assertion. For the PR step it follows the
same steps the real body prescribes — derive the commit style from `git log`
(default semantic / Conventional Commits when history is inconclusive), author one
commit on the work branch in that style, record exactly one PR-open action
(sentinel capturing the work/base branch it was handed), and report completion via
the `ratchet batch report <batch> --change pr:<batch> --complete …` channel the
instructions carry. Because the seeded history is semantic, the fake derives a
semantic message from `git log` rather than hard-coding one — exercising the
"read git log, default semantic" behavior the flow delegates to the skill. The
branch names it commits/records come from the instruction "Input" (delivered as
data by the CLI), not from the skill re-deriving them.

**Driving a batch "to completion" without a real agent lifecycle.** The E2E
reproduces the same *completed-batch* on-disk state the integration suite uses via
`fixture.completeVerify` / `fixture.passProof`: a single-phase batch whose only
change `c1` has all tasks checked, a journaled `verify` completion, and a recorded
passing terminal boundary proof — so `batch status` resolves the batch to `done`
and `batch apply` reaches the completion PR step immediately. It reuses the batch
run-state/journal helpers (`appendJournal`, `recordProofOfWork`, or the
`BatchFixture` wrapper) to seed that state, then initializes the temp root as a git
repo — an initial semantic-style `git log`, a configured `origin` remote (so
`resolveBranches` and the doctor remote check see a remote), and a `feat/…` work
branch carrying uncommitted work. Fixture setup via helpers is separate from the
assertion surface: the behavior under test is driven exclusively through the
compiled CLI, satisfying "drive the built CLI in E2E tests".

**Idempotency and failure ride the run-state journal, asserted through the CLI
(`delegated-lifecycle`).** The re-run scenario runs `batch apply` twice and asserts
the second run neither spawns nor adds a second PR-open action and prints the
unchanged done message — proving the "PR opened" rule (`hasJournaledPr`) recorded
by the first run's `completion` entry gates the second, with no bespoke lock. The
failure scenario points `RATCHET_BATCH_AGENT_CMD` at a stand-in that exits non-zero
without reporting a completion; the shared outcome mapping records a `blocker`
(never a `completion`), so the CLI renders a reported failure, `hasJournaledPr`
stays unset, and a retry remains possible — all observed through CLI output and
run-state, no new failure logic.

**Isolation and traceability (`testing`).** The E2E builds its repo under
`fs.mkdtemp(os.tmpdir())`, writes only the minimal `.ratchet/` tree plus the git
repo it exercises, and removes it in `afterAll`, depending on no real repository or
sibling test and leaving nothing behind. Its file header names
`features/whole-batch-pr/completion-e2e.feature` so the behavior contract it proves
is traceable, matching the `test/cli-e2e/` conventions. The full suite and the
coverage gate stay green at or above the enforced `COVERAGE_THRESHOLD` (this change
adds a test and docs only, so coverage does not regress).

**Documentation completes the deferred overview diagram (`documentation`,
mandatory).** Every prior Phase 2 slice explicitly deferred the whole-batch
PR-flow overview diagram to this change, citing the standard's "do not
over-document visually" guidance — the flow is core, central, and now fully
shipped, so it earns exactly one overview diagram here.
- `docs/engine/agent-runtime.md` — add an `## Overview` lead to the existing
  "Completion PR step" section whose **first artifact** is a Mermaid flowchart.
  It is an activity/flow diagram (matching a process), **vertically oriented**
  (`flowchart TD`) as required for a core/large subject, high-contrast with every
  `classDef` setting an explicit `color:` (light fill/dark text and vice-versa),
  and nodes prefixed with semantic Unicode symbols used consistently (e.g. ✅
  completion, 🔀 gate/decision, ⚙️ spawned agent, 📝 commit, 🌐 forge/PR, 💾
  run-state). It depicts: batch `done` → CLI gate on `prGrouping` (`off`/unset →
  ❌ no PR, "Nothing to do"; `whole-batch` → continue) → gate on `hasJournaledPr`
  (already opened → no PR) → spawn one `pr`-stage agent → `/rct:pr-open` derives
  git-log style, commits, pushes, opens exactly one PR → record `pr` completion in
  run-state. The diagram is valid, renders, and matches the shipped code.
- `README.md` — document the `prGrouping` setting (`off` default opens no PR;
  `whole-batch` opens one PR at completion) and the `pr` fourth routable agent
  stage (both already partially present via the agent-map and git-remote lines,
  extended here into a short PR-flow narrative), and carry the **same**
  high-contrast vertical Mermaid overview so a reader can see the flow as a
  picture. Prose is austere, factual Reference style — no tutorial or rationale.
- Accuracy: `docs/configuration/config-yaml.md` already documents `prGrouping` and
  the per-stage `pr` map (shipped by `pr-grouping-config`) and
  `docs/commands/doctor.md` already documents the remote warning (shipped by
  `doctor-pr-remote-warning`); this change verifies they remain accurate and adds
  no stale flag/default/config key. No `src/` surface changes, so no other
  Reference entry needs updating.

## Tasks

- [x] 1.1 Add `test/cli-e2e/batch-pr-whole-batch.test.ts` with a header naming
  `features/whole-batch-pr/completion-e2e.feature`. Build an isolated fixture:
  `fs.mkdtemp(os.tmpdir())` root, `git init` with an initial semantic-style commit,
  a configured `origin` remote, a `feat/…` work branch with uncommitted work, and a
  completed single-phase `prGrouping: whole-batch` batch (`c1` tasks all checked, a
  journaled `verify` completion, a recorded passing terminal boundary proof) seeded
  via the batch run-state/journal helpers. Clean up in `afterAll`.
- [x] 1.2 Add the forge-agnostic fake PR agent as a POSIX shell stand-in wired
  through `RATCHET_BATCH_AGENT_CMD` (forwarded via `runCLI` `env`): read stdin
  instructions; for the `/rct:pr-open` step derive the commit style from `git log`
  (semantic default), author one commit on the work branch in that style, write one
  PR-open sentinel capturing the handed work/base branch, and report completion via
  the `ratchet batch report … --change pr:<batch> --complete` channel. Uses git
  only — no forge CLI, no hard-coded forge.
- [x] 2.1 (`testing`) Implement the happy-path E2E scenario: run `ratchet batch
  apply b` against the fake seam; assert exactly one spawn / one PR-open sentinel,
  the authored commit matches a semantic / Conventional-Commit subject regex, and
  exit code 0.
- [x] 2.2 (`testing`) Implement the `off` and unset scenarios: assert no spawn, no
  sentinel, the unchanged `Nothing to do — all changes are done.` output, and exit
  0.
- [x] 2.3 (`testing`) Implement the idempotent re-run scenario: a second `batch
  apply` adds no second spawn/sentinel and prints the unchanged done message (PR
  state read from run-state).
- [x] 2.4 (`testing`) Implement the failure scenario: a fake agent exiting non-zero
  without a reported completion surfaces a reported step failure, records no `pr`
  completion in run-state, and leaves a retry possible. Confirm the full suite and
  the coverage gate stay green at/above the enforced `COVERAGE_THRESHOLD`.
- [x] 3.1 (`documentation`, mandatory — `documentation` tag) Add the `## Overview`
  lead with the high-contrast, vertically-oriented (`flowchart TD`) Mermaid
  overview of the whole-batch PR flow to the "Completion PR step" section of
  `docs/engine/agent-runtime.md`, as the section's first artifact: every `classDef`
  sets an explicit `color:`, nodes carry consistent semantic Unicode symbols, and
  the flow (completion → `prGrouping` gate → `hasJournaledPr` gate → one `pr`-stage
  agent → `/rct:pr-open` commit/push/one-PR → run-state record) matches the shipped
  code. Verify it is valid, renders, and is not stale.
- [x] 3.2 (`documentation`, mandatory — `documentation` tag) Update `README.md` to
  document `prGrouping` (`off` default / `whole-batch`) and the `pr` fourth
  routable agent stage as a short PR-flow narrative, and embed the same
  high-contrast vertical Mermaid overview. Verify `docs/configuration/config-yaml.md`
  and `docs/commands/doctor.md` remain accurate (no stale flag/default/config key).
