# Web-deterministic fold

## Why

`kind: web` bindings are representable (`web-binding-schema`) and the harness that
boots/waits/runs/tears them down exists (`web-lifecycle-harness`), but `judgeCase`
still throws for `web` bindings and nothing gates on their outcome. Tier-4 browser
scenarios can't run through `ratchet eval run` until the harness's result is
reduced to a `CaseVerdict` and folded into an existing contributor — this is the
missing wiring the rest of the `playwright-web-tier` phase (failure-artifact
capture, the doctor probe) builds on.

## What Changes

- `judgeCase` in `src/core/eval/judge.ts` dispatches `kind: 'web'` bindings through
  `runWebLifecycle` (already built by `web-lifecycle-harness`) instead of throwing,
  reducing the harness's `WebLifecycleOutcome` to a `CaseVerdict` in the same shape
  `judgeCheck` returns for `deterministic` bindings: exit-zero Playwright run =
  `pass`, non-zero exit or a readiness timeout = `fail` (fail-closed — a timeout
  never runs the spec and is never treated as an assumed pass).
- `aggregate.ts`'s `deterministicContributor` treats a `web`-bound case judged
  `fail` the same as a `deterministic`-bound one — no new `ContributorId` is
  introduced. A new exported `contributorForBindingKind(kind: BindingKind):
  ContributorId` is the single place a binding kind maps to the contributor that
  gates it (`web` and `deterministic` both fold to `'deterministic'`; `llm-judge`
  stays `'llm-judge'`).
- `execute.ts` fixes an existing latent bug this change's scope surfaces: it derives
  the enabled-contributor check via `bound.binding.kind as ContributorId`, an
  unsound cast for `'web'` (`ContributorId` has no `'web'` member, so a `web`-bound
  case's contributor lookup in the gate `Set<ContributorId>` would never match and
  every `web`-bound case would silently record `unjudged` regardless of the gate).
  Replaced with `contributorForBindingKind`, so `eval.gate.deterministic`,
  `--only`, and `--gate` control `web`-bound cases exactly as they already control
  `deterministic`-bound ones.
- Implements `features/web-deterministic-fold/judge-dispatch.feature` (dispatch and
  verdict reduction) and `features/web-deterministic-fold/deterministic-contributor-fold.feature`
  (contributor fold and gate selection).
- **Out of scope** (later changes in the `playwright-web-tier` phase per
  `.ratchet/batches/mature-eval/batch.yaml`): trace/screenshot capture on failure
  (`web-failure-evidence`) and the conditional `ratchet doctor` Playwright probe
  (`doctor-conditional-playwright-probe`). No evidence artifact is persisted by
  this change beyond the existing `ClauseResult.evidence` string.
- No agent-facing surface (no skills/commands/templates) — the Playwright
  invocation the harness makes stays a plain `bash(command, cwd)` call with no
  agent involved, so `judgeWeb` is agent-neutral by construction, matching
  `judgeCheck`.

## Design

**`judgeWeb` mirrors `judgeCheck`'s shape.** `judgeCheck(binding, cwd, deps)` bashes
a command and reduces a `BashResult` to a one-clause `CaseVerdict`; `judgeWeb`
follows the identical pattern but calls `runWebLifecycle` instead of a bare bash
call, since the lifecycle (start/poll/run/teardown) is already encapsulated there:

```ts
async function judgeWeb(binding: WebBinding, cwd: string, deps: JudgeDeps): Promise<CaseVerdict> {
  const outcome = await runWebLifecycle(binding, cwd, deps.web ?? {});
  const rubric = [`Playwright spec '${binding.spec}' exits zero`];
  if (outcome.kind === 'readiness-timeout') {
    const clauses: ClauseResult[] = [{
      clause: rubric[0],
      pass: false,
      evidence: `App did not become ready within ${binding.readiness.timeoutMs}ms; Playwright spec was never run.`,
    }];
    return { verdict: 'fail', evidence: clauses, rubric, votes: [{ pass: false, clauses }] };
  }
  const { passed, result } = outcome;
  const detail = result.stderr.trim() || result.stdout.trim();
  const clauses: ClauseResult[] = [{
    clause: rubric[0],
    pass: passed,
    evidence: passed
      ? `Playwright spec '${binding.spec}' passed (exit 0)`
      : `Playwright spec '${binding.spec}' failed (exit ${result.exitCode})${detail ? `: ${detail.slice(0, 500)}` : ''}`,
  }];
  return { verdict: passed ? 'pass' : 'fail', evidence: clauses, rubric, votes: [{ pass: passed, clauses }] };
}
```

- `JudgeDeps` gains an optional `web?: WebLifecycleDeps` field, threaded straight
  into `runWebLifecycle` — the same injectable-seam pattern `bash`/`spawner`
  already use, so `judgeCase` tests for `web` bindings inject fake
  `start`/`checkReadiness`/`bash`/`sleep`/`now` and never spawn a real process,
  matching how `web-lifecycle.test.ts` already tests the harness in isolation.
- `judgeCase`'s dispatch drops the `throw` for `web` and calls `judgeWeb(binding,
  cwd, deps)` — no `EvalCase` needed (mirrors `judgeCheck`'s signature, since the
  Playwright spec itself drives the case's Given/When/Then, not a rubric derived
  from the scenario's steps).

**One mapping function owns binding-kind → contributor.** `contributorForBindingKind`
lives in `aggregate.ts` next to `ContributorId`/`deterministicContributor` — the
same module that owns the contributor vocabulary — as an exhaustive switch over
`BindingKind` so a future new `BindingKind` fails to compile here rather than
silently defaulting:

```ts
export function contributorForBindingKind(kind: BindingKind): ContributorId {
  switch (kind) {
    case 'llm-judge':
      return 'llm-judge';
    case 'deterministic':
    case 'web':
      return 'deterministic';
  }
}
```

- `failingOfKind(run, kinds: BindingKind[])` (was a single `'deterministic' |
  'llm-judge'` kind) now takes a kind list so `deterministicContributor` can match
  `['deterministic', 'web']` while `llmJudgeContributor` matches `['llm-judge']` —
  the smallest change that lets one case-partitioning helper serve both
  contributors without introducing a `'web'` contributor id anywhere.
- `execute.ts` replaces `const contributor = bound.binding.kind as ContributorId;`
  with `const contributor = contributorForBindingKind(bound.binding.kind);` — this
  is the fix that makes `eval.gate.deterministic` / `--only` / `--gate` actually
  reach `web`-bound cases; today's cast means a `web`-bound case's contributor
  lookup (`options.gate.has('web')`) can never be `true` since `gate` is built
  from `ALL_CONTRIBUTOR_IDS` (which has no `'web'` member), so every `web`-bound
  case is unconditionally recorded `disabledContributor('web')` regardless of the
  configured gate — this change corrects that so a `web`-bound case's fixture is
  only skipped when `deterministic` itself is disabled, and only then.
- `contributorForBindingKind` is barrelled through `src/core/eval/index.ts`
  alongside the existing `aggregate.js` exports.

**Documentation** (per the `documentation` standard — mandatory, not optional):
- `docs/eval-web-lifecycle.md`: replace the "Not yet wired into `judgeCase`"
  callout — `judgeCase` now dispatches `web` bindings through the harness and
  folds the result into the `deterministic` contributor; the doc must not keep
  claiming the wiring is deferred once it lands.
- `docs/eval-verdict-aggregation.md`: update the `deterministic` contributor's
  table row and the "partition the run's cases by `bindingKind`" prose to name
  `web` alongside `deterministic`, and document `contributorForBindingKind` as the
  binding-kind-to-contributor mapping the aggregation core and `execute.ts` share.
- `docs/commands/eval.md`'s `### Web binding` section: replace the closing
  paragraph ("not yet wired into `ratchet eval run`... still throws") with the
  now-true statement that `web` bindings run through `ratchet eval run` and gate
  via `eval.gate.deterministic`/`--only`/`--gate` exactly like `deterministic`
  bindings, while still noting failure-artifact capture and the doctor probe
  remain deferred to their own later changes (never claim aspirational behavior).
- `README.md`: the existing "A third kind, `web`, declares a browser-scenario
  lifecycle..." sentence gets a short clause noting it now gates as a
  `deterministic` contributor case (exit-zero Playwright run = pass) — this
  changes previously-throwing, user-observable behavior, so the README must not
  go stale per the `documentation` standard.

## Tasks

- [x] 1.1 In `src/core/eval/aggregate.ts`: import `BindingKind` from `./spec.js`,
      generalize `failingOfKind` to take `kinds: BindingKind[]`, add exported
      `contributorForBindingKind(kind: BindingKind): ContributorId` (exhaustive
      switch, `web` → `'deterministic'`), and update `deterministicContributor`/
      `llmJudgeContributor` to call `failingOfKind` with `['deterministic', 'web']`
      / `['llm-judge']` respectively, per the Design section.
- [x] 1.2 In `src/core/eval/execute.ts`: replace the unsound
      `bound.binding.kind as ContributorId` cast with
      `contributorForBindingKind(bound.binding.kind)`.
- [x] 1.3 In `src/core/eval/judge.ts`: import `WebBinding` (from `./spec.js`) and
      `runWebLifecycle`/`type WebLifecycleDeps` (from `./web-lifecycle.js`), add
      `web?: WebLifecycleDeps` to `JudgeDeps`, add `judgeWeb` per the Design
      section, and change `judgeCase`'s `web` branch to call `judgeWeb` instead of
      throwing.
- [x] 1.4 Barrel `contributorForBindingKind` through `src/core/eval/index.ts`
      alongside the existing `aggregate.js` exports.
- [x] 2.1 Extend `test/core/eval/judge.test.ts` covering
      `features/web-deterministic-fold/judge-dispatch.feature`: a ready app with a
      zero-exit Playwright spec judges `pass`, a ready app with a non-zero-exit
      spec judges `fail` with evidence citing the spec, and a readiness timeout
      judges `fail` with evidence citing the timeout while the injected `bash` for
      the Playwright run is never invoked — using injected `web` deps
      (`start`/`checkReadiness`/`bash`/`sleep`/`now`) so no test spawns a real
      process.
- [x] 2.2 Extend `test/core/eval/aggregate.test.ts` covering
      `features/web-deterministic-fold/deterministic-contributor-fold.feature`'s
      first two scenarios: a `web`-bound `fail` case fails the `deterministic`
      contributor and is named in its failing ids; a run with only passing
      `web`-bound cases passes the `deterministic` contributor and
      `aggregateRun`'s contributor ids are exactly the four built-in ids (no
      `'web'` id appears). Also add a direct unit test for
      `contributorForBindingKind` covering all three `BindingKind` values.
- [x] 2.3 Extend `test/core/eval/execute.test.ts` covering
      `features/web-deterministic-fold/deterministic-contributor-fold.feature`'s
      last two scenarios: disabling the `deterministic` contributor (via
      `options.gate`) leaves a `web`-bound case `unjudged` naming
      `'deterministic'` as the disabled contributor with no fixture materialized
      (proving the app is never started); restricting the gate to `deterministic`
      only (`--only deterministic`-equivalent `options.gate`) still judges a
      `web`-bound case while a sibling `llm-judge`-bound case is recorded
      `unjudged` naming `'llm-judge'` as disabled.
- [x] 3.1 Update `docs/eval-web-lifecycle.md` per the Design section: replace the
      "Not yet wired into `judgeCase`" callout with the current wiring.
- [x] 3.2 Update `docs/eval-verdict-aggregation.md` per the Design section: the
      `deterministic` contributor row/prose and `contributorForBindingKind`.
- [x] 3.3 Update `docs/commands/eval.md`'s `### Web binding` section per the
      Design section.
- [x] 3.4 Update `README.md`'s web-binding sentence per the Design section.
