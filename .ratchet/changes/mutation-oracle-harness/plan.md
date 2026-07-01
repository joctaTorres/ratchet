# mutation-oracle-harness

## Why

The mutation invariant's schema (`mutation-invariant-schema`) can already
declare a `test`/`budget`/`threshold` entry, but nothing can run one:
`evaluateMutation` is a fail-closed placeholder. Before the evaluator can fold
mutation testing into the `invariants` contributor, an agent-neutral harness
needs to exist that actually seeds a fault, runs the user's own test suite
against it, and classifies the result — the mechanical core the "no external
mutation framework" design promises. This slice builds only that harness,
mirroring how `web-lifecycle-harness` shipped `runWebLifecycle` standalone
before `web-deterministic-fold` wired it into `judgeCase`.

## What Changes

This implements `features/mutation-harness/seed-and-classify.feature` and
`features/mutation-harness/fail-closed-preconditions.feature`:

- Add `src/core/eval/mutation-harness.ts`, a new standalone module exporting
  `runMutationHarness(invariant: MutationInvariant, cwd: string, deps?: MutationHarnessDeps)`:
  for up to `invariant.budget` attempts, it spawns the configured coding agent
  through the existing spawn seam (`resolveAdapter` / `AgentAdapter.buildRequest`
  / `Spawner`) with instructions to seed exactly one small, discrete fault
  directly into a non-test source file, detects what changed via git, and — only
  when something actually changed — runs `invariant.test` as the deterministic
  oracle, classifies the mutant `killed` (oracle now fails) or `survived` (oracle
  still passes), and reverts the fault before the next attempt.
- Add a fail-closed precondition: the harness refuses to seed anything unless the
  project's git working tree is already clean, returning a distinct
  `unusable-working-tree` outcome instead of mutating an unknown state.
- Export the new module's public surface from `src/core/eval/index.ts`, matching
  the `web-lifecycle.ts` export block's shape.
- No change to `evaluateMutation`/`evaluateInvariant`: this harness is
  deliberately **not wired** into the invariant evaluator yet — reducing its
  output to an `InvariantOutcome` (with budget/threshold semantics) is
  `mutation-evaluator-fold`'s job, exactly as `web-deterministic-fold` was a
  separate change from `web-lifecycle-harness`.
- Add `docs/eval-mutation-harness.md` (new Reference doc) and update
  `docs/eval-invariants.md` and `README.md`'s mutation mentions.

## Design

**The agent applies the fault; the harness only detects and reverts it.** The
spawned agent edits a file directly with its own tools (the same way an
`apply`/`propose` agent already edits files in a working copy) — the harness
never parses or constructs a patch itself. This mirrors `judgeAgent`'s division
of labor: the agent produces a judgment (or, here, a mutation), the harness
only orchestrates the call and interprets the result.

**Detection and revert use `git`, invoked through the existing `BashRunner`
seam — not a new dependency.** After each seed attempt the harness runs
`git add -A` (stages tracked *and* untracked changes so a new file the agent
created is part of the diff, not silently invisible) followed by
`git diff --cached` to capture the fault as a unified diff. An empty diff means
the agent made no change this attempt: no mutant is recorded and the oracle is
never run for it (an attempt is not a mutant). A non-empty diff runs
`invariant.test` via the same `bash` seam `evaluateDeterministic` and
`judgeCheck` already use, classifies `exitCode === 0` as `survived` and
non-zero as `killed`, and unconditionally reverts with
`git reset --hard HEAD && git clean -fd` before the loop's next iteration —
restoring both tracked and untracked state, whether the mutant was killed or
survived. `git` is invoked exactly like every other command this codebase
already shells out to (`check.run`, `produce.run`, Playwright); it is treated as
part of the project's environment, not a new external tool or an
ecosystem-specific default under `generalizable-defaults` — the `test` command
itself stays 100% user-supplied with zero ratchet-authored literal, matching
that standard.

**Fail-closed precondition: refuse to run against a dirty or non-git working
tree.** Before seeding anything, the harness runs `git status --porcelain`. A
non-empty result (uncommitted changes) or a non-zero exit (not a git
repository, or git unavailable) returns `{ kind: 'unusable-working-tree',
reason }` with no spawn and no oracle run. Without this guard the harness could
not tell a fault it seeded apart from a user's pre-existing edit, and a
`git diff`/`git reset --hard` cycle over an already-dirty tree would either
misattribute or destroy uncommitted work. This is the same fail-closed
philosophy `invariant-evaluator.ts` already applies to every other kind
(missing baseline, absent golden ⇒ `unevaluable`, never a guessed pass) —
applied here as a precondition rather than a per-mutant outcome, since it is
the invariant of *safety*, not of *classification*.

**Budget bounds attempts, not just mutants.** The loop runs at most
`invariant.budget` iterations regardless of how many of them actually seed a
mutant (an empty-diff attempt still consumes one iteration), which keeps the
cost ceiling the schema's docstring promises ("at most this many mutants are
seeded per run") from being circumvented by an agent that repeatedly no-ops.
`threshold` (the floor on how many mutants must be *evaluated* for the
invariant to be trustworthy) is deliberately **not** enforced here — comparing
`mutants.length` against `threshold` and deciding `unevaluable` is
`mutation-evaluator-fold`'s job, once this harness's result feeds the evaluator.

**Spawn call shape mirrors `judge.ts`'s `buildVoteRequest`/`castVote` exactly.**
A `buildSeedRequest` helper honors the same `RATCHET_EVAL_AGENT_CMD` override
(so e2e tests can swap in a scripted command instead of a real agent,
deterministically) before falling back to `resolveAdapter(agentName).buildRequest(...)`.
The `AgentRequestContext` built for the call is the same minimal shape
`judgeContext()` uses (`{ batch: 'eval', change: invariant.id }`, no
`settings.permissions`) — this is an existing precedent, not a new gap this
change introduces. There is no agent-specific branch anywhere in the module:
every agent flows through the same adapter registry, satisfying
`multi-agent-support` and the phase's "no agent-specific spawn path" criterion
by construction, the same way `runWebLifecycle`'s plain-bash Playwright
invocation does for that harness.

**Prompt-level, not runtime-enforced, protection of the oracle.** The seed
instructions explicitly tell the agent to change only production source, never
a test file, and to make the smallest plausible single-file edit without
running the test suite itself. This is a trust boundary identical to
`buildJudgeInstructions`' "don't guess, cite evidence" instruction: the harness
cannot mechanically verify the agent obeyed a natural-language instruction, so
it is not asserted in tests — only the harness's own mechanical contract
(seed → detect → run oracle → classify → revert) is.

**Testing strategy (`testing` standard).** `runMutationHarness` is proven at
the **unit** layer in a new `test/core/eval/mutation-harness.test.ts`, injecting
fake `bash`/`spawner` seams exactly like `web-lifecycle.test.ts` and
`judge.test.ts` — no real git command runs and no real agent spawns. The file
header names both feature files. Cases: a survived classification, a killed
classification, revert running before the next seed attempt (asserted via the
fake bash's recorded call order), the budget ceiling never exceeded, a
no-diff attempt not counted as a mutant (and the oracle never invoked for it),
agent-neutral dispatch (spawn requests built through the adapter registry
rather than any hardcoded agent), the dirty-working-tree precondition
short-circuiting with zero spawns, the not-a-git-repo precondition, and the
working tree ending in its starting state after a full multi-mutant run
(including when a mutant survives). The full suite and coverage gate stay
green at or above the enforced `COVERAGE_THRESHOLD`.

**Documentation strategy (`documentation` standard).** Add
`docs/eval-mutation-harness.md`, mirroring `docs/eval-web-lifecycle.md`'s
structure: an `## Overview` section leading with a vertical Mermaid diagram of
the seed → stage/diff → (empty ⇒ skip | non-empty ⇒ run oracle → classify →
revert) loop and the fail-closed precondition, a `## Contract` section for the
`runMutationHarness` signature, a sequence walkthrough, an injectable-seams
table (`MutationHarnessDeps`), the `MutationHarnessOutcome` shape, and an
`## Agent-neutrality` section — explicitly noting, like `web-lifecycle.ts`'s
docstring precedent, that this harness is **not yet wired** into
`evaluateMutation`/`evaluateInvariant` (that lands in `mutation-evaluator-fold`).
Update `docs/eval-invariants.md`'s `### kind: mutation` subsection: replace
"nothing can construct an active mutation invariant yet" language with a note
that the seed/oracle/classify/revert harness now exists standalone at
`src/core/eval/mutation-harness.ts` (linking to the new doc), while keeping the
"`evaluateInvariant` resolves every `kind: mutation` entry to a fail-closed
`unevaluable` placeholder" sentence accurate (still true — unchanged in this
slice). Update `README.md`'s `mutation` bullet under "Invariants" to add a short
mention that the standalone seed/oracle/classify/revert harness now exists,
linking to the new doc, while keeping "evaluation lands in a follow-on change"
accurate to `evaluateInvariant`'s unchanged dispatch.

## Tasks

- [x] 1.1 Add `src/core/eval/mutation-harness.ts`: `MutantOutcome`
      (`index`, `diff`, `outcome: 'killed' | 'survived'`, `testResult`),
      `MutationHarnessOutcome` (`{ kind: 'unusable-working-tree'; reason: string }
      | { kind: 'completed'; mutants: MutantOutcome[] }`),
      `MutationHarnessDeps` (`bash?`, `spawner?`, `agentName?`),
      `buildSeedInstructions(invariant)`, and
      `runMutationHarness(invariant, cwd, deps?)` implementing the precondition
      check (`git status --porcelain`), the budget-bounded seed/stage-diff/
      oracle/classify/revert loop, and the `RATCHET_EVAL_AGENT_CMD`-aware spawn
      request builder mirroring `judge.ts`'s `buildVoteRequest`/`castVote`.
- [x] 1.2 Export `runMutationHarness`, `buildSeedInstructions`, and the new
      types from `src/core/eval/index.ts`, alongside the existing
      `web-lifecycle.ts` export block.
- [x] 2.1 Add `test/core/eval/mutation-harness.test.ts` (unit layer, fake
      `bash`/`spawner`, header naming both `.feature` files) covering: survived
      classification; killed classification; revert-before-next-seed ordering;
      the budget ceiling never exceeded; a no-diff attempt not recorded as a
      mutant and the oracle never run for it; agent-neutral spawn dispatch
      (built through the adapter registry, not a hardcoded agent); the dirty
      working tree precondition (zero spawns, zero oracle runs); the
      not-a-git-repository precondition; and the working tree ending in its
      starting state after a full run, including when a mutant survives.
- [x] 2.2 Run `pnpm build && pnpm vitest run mutation` and the full suite +
      coverage gate; confirm green at or above the enforced
      `COVERAGE_THRESHOLD`.
- [x] 3.1 (documentation — mandatory, `documentation` standard) Add
      `docs/eval-mutation-harness.md` (Overview with a vertical, high-contrast
      Mermaid diagram of the seed/detect/classify/revert loop and the
      fail-closed precondition; Contract; Sequence; injectable-seams table;
      `MutationHarnessOutcome` shape; Agent-neutrality section; explicit note
      that the harness is not yet wired into `evaluateInvariant`).
- [x] 3.2 (documentation — mandatory) Update `docs/eval-invariants.md`'s
      `### kind: mutation` subsection to link the new doc and describe the
      harness's existence (still unwired), and update `README.md`'s `mutation`
      bullet under "Invariants" with a short mention linking to the new doc.
