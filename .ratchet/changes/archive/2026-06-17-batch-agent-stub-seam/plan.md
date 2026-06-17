# batch-agent-stub-seam

## Why

`ratchet batch apply` can only be exercised by spawning a real coding agent
(`resolveAdapter` + `realSpawner` in the engine), so the batch eval cannot
deterministically assert the engine's orchestration — the apply/transition/halt
scenarios sit `unjudged` because a `kind: check` can't drive an LLM
reproducibly. The eval system already solved this for itself with
`RATCHET_EVAL_AGENT_CMD`; batch needs the same seam so "batch works" becomes a
deterministic, reproducible assertion instead of a flaky depth-2 agent-in-agent.

## What Changes

- **Engine spawn seam**: when `RATCHET_BATCH_AGENT_CMD` is set, the engine runs
  that command via `bash -c` (feeding the step instructions on stdin) **instead
  of** resolving/spawning the configured agent adapter. Unset → today's adapter
  path is used unchanged; the open CLI behavior is unaffected. Mirrors
  `RATCHET_EVAL_AGENT_CMD` in `src/core/eval/judge.ts`.
  (`features/agent-stub/deterministic-agent.feature`)
- **Scripted-agent eval fixture** under `.ratchet/evals/fixtures/` and updated
  `.ratchet/evals/specs/batch-orchestration.yaml`: the previously-unjudged
  `batch-apply/*`, transition-order, and halt/resume scenarios are converted to
  `kind: check` that set `RATCHET_BATCH_AGENT_CMD` to a deterministic scripted
  agent and assert the observable batch state.
  (`features/batch-eval/orchestration-eval.feature`)
- **Known gap kept honest**: the proof-of-work phase-gating scenarios remain
  `unjudged` (the `runProofOfWork` host loop is deliberately not wired into
  `runStep`/`apply` yet) — the spec documents this as the remaining gap to 100%.

## Design

**One narrow interception point.** In `RatchetBatchEngine.runStep`
(`src/core/batch/engine/engine.ts`), the agent request is built today as
`adapter.buildRequest(stepContext, instructions, projectRoot, env)` then run via
`this.spawner(request)`. Add an override check just before adapter resolution
(~line 109): if `process.env.RATCHET_BATCH_AGENT_CMD?.trim()` is non-empty,
build `{ command: 'bash', args: ['-c', override], instructions, cwd:
projectRoot, env }` and skip `resolveAdapter`. Everything downstream — journal
snapshot/diff, `mapSessionToOutcome`, park-for-approval, `StepResult` — is
unchanged, so the stub flows through the exact same orchestration as a real
agent. This is the minimal, additive change; the `Spawner` injection
(`deps.spawner`) used by unit tests is untouched and complementary (the env seam
is for the CLI/e2e path where no `deps` are injectable).

**Why an env var, not a flag or config.** It matches the existing
`RATCHET_EVAL_AGENT_CMD` precedent exactly (one consistent mechanism for "stand
in for the agent binary"), needs no manifest/config schema change, and is a
test/eval seam rather than a user-facing feature — keeping it out of `batch
config` avoids implying it's a normal operating mode.

**The scripted agent.** A small bash script (checked in under the fixture, e.g.
`fixtures/batch-apply/agent.sh`) that branches on the transition implied by the
current change's disk state: on propose it scaffolds the change dir + a plan; on
apply it checks the plan's task boxes; on verify it emits a pass; and it reports
via `ratchet batch report` so the engine's journal-reading path is exercised. A
second variant raises a blocker to drive the halt/resume scenario. Because the
script is deterministic and controllable, branches a real agent would hit only
by chance (blocker, awaiting-approval, reject) become reproducible checks.

**Tool-agnostic (multi-agent standard).** The seam is agent-neutral: it replaces
*whichever* adapter would have been resolved, for every supported agent, with
no agent-specific code path. No generated skill/command surface changes.

## Tasks

- [x] 1.1 Add the `RATCHET_BATCH_AGENT_CMD` override in `src/core/batch/engine/engine.ts` `runStep` (bash `-c`, instructions on stdin, skips `resolveAdapter`); keep the unset path identical
- [x] 1.2 Unit test in `test/batch-engine/` asserting: override set → request is `bash -c <cmd>` with instructions on stdin; unset → adapter resolved as before; non-zero stub → `state: 'failed'` and run-state stays consistent
- [x] 2.1 Add the scripted-agent fixture(s) under `.ratchet/evals/fixtures/` (happy-path agent + a blocker-raising variant) as a self-contained batch project
- [x] 2.2 Convert the recovered cases in `.ratchet/evals/specs/batch-orchestration.yaml` to `kind: check` driving the stub: `batch-apply#apply-advances-one-step-and-returns`, `#apply-respects-gates-and-does-not-cross-a-halt`, `#apply-renders-a-rich-view-of-the-step-it-ran`, `create-batch#changes-are-created-lazily-as-the-batch-progresses`. NOTE: `#the-transition-sequence-per-change-is-propose-then-apply-then-verify` is left UNJUDGED — its *verify* leg is the deferred host loop (a change with all tasks checked is `done`, which `batch apply`'s step-picker treats as terminal, so verify is never re-selected). The `batch-engine` cases are out of this spec's scope (`--change batch-orchestration`), so they are deferred to a `--change batch-engine` follow-up.
- [x] 2.3 Leave the proof-of-work phase-gating cases unjudged with an explicit deferred-host-loop comment in the spec; do not force them
- [x] 3.1 `ratchet eval run --change batch-orchestration --judge check` is green for all newly-bound cases and stable across two runs (38 pass / 0 fail / 15 unjudged, was 34 bound); store enumeration unchanged at 112. `--changes` rises 252→260 only because this change's own 8 feature scenarios are now on disk and enumerated — not from the fixtures.
- [x] 3.2 `pnpm build`, `pnpm test` (1024), `pnpm lint`, `pnpm exec tsc --noEmit` all pass; seam noted in `.ratchet/evals/README.md`
