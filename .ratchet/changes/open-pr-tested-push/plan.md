# open-pr-tested-push

## Why

The open-pr workflow can claim more than it proved: its rendered body commits,
pushes, and opens the batch's pull request with no evidence the tree is green —
nothing runs the project's own test command, so a red tree can be pushed and
PRed as if it were tested — and nothing forbids force-pushing or retrying a
rejected push, so a rejected push can silently become a forced one. Absorb the
batch-approved honesty sharpening for open-pr: the template runs the project's
own discovered test command on the committed tree before pushing, refuses to
push red or open the PR on a red/unrun result, never force-pushes, and stops
and reports a rejected push instead of retrying.

## What Changes

- Add the tested-push guardrails to the shared `OPEN_PR_BODY` in
  `src/core/templates/workflows/open-pr.ts` — already one shared constant
  consumed by both `getOpenPrSkillTemplate().instructions` and
  `getRctOpenPrCommandTemplate().content`, so the skill and command cannot
  drift (features: `open-pr-tested-push/tested-push.feature`):
  - **Test gate between commit and push.** A new step between "Commit the
    accumulated uncommitted work" and "Push the work branch to its remote":
    discover the project's own test command from the project itself — its
    package manifest test script, a Makefile test target, CI configuration, or
    whatever the project already declares — with no new ratchet configuration
    and no assumed toolchain, and run it fresh on the committed tree (the
    exact commit that will be pushed) before any push.
  - **Red or unrun means stop.** A failing fresh run: STOP and report the
    exact command and its failing result — never push a red tree, and the pull
    request is never opened on a red or unrun test result. No test command
    discoverable, or the run cannot complete: STOP and report the reason — the
    pull request is opened only on a fresh green run of the project's own test
    command.
  - **Never force-push; a rejected push stops the step.** The push step
    forbids force-pushing under any circumstances (no `git push --force`, no
    `--force-with-lease`) and directs the agent to STOP and report a rejected
    push, naming the remote's rejection, instead of retrying the push or
    forcing it — the engine surfaces it as a reported step failure, so the
    group stays retryable by a later run exactly as a commit/push failure does
    today.
  - **Output cites the test evidence.** The PR-step output summary gains the
    exact test command discovered and run and its fresh green result,
    alongside the commit style, the commit, the pushed branch, and the single
    pull request opened. The Guardrails block gains the matching one-liners.
- Trim the engine's PR-step delegation guidance in
  `src/core/batch/engine/instructions.ts` (`prDelegationGuidance`) so it no
  longer carries a parallel copy of the PR-open lifecycle: the sentences
  re-describing the `git log` commit-style read, the accumulated-work commit,
  the work-branch push, and the forge-CLI PR-open are deleted, and the
  guidance keeps only the `/rct:open-pr` invocation token, the
  standards-loading sentence, and the "Do NOT hand-build or re-describe the
  PR-open steps — delegate to the skill" wording, with the work/base Input
  from `prInputContext` unchanged. A new unit test in
  `test/batch-engine/pr-spawn-at-completion.test.ts` pins the PR prompt: it
  contains the invocation, the Do-NOT-hand-build wording, and the branches,
  and does NOT match `git log`, `accumulated work`, `push the work branch`, or
  `forge CLI`.
- Extend `test/core/shared/lifecycle-honesty.test.ts` — the shared phase file
  created by `verify-honest-report` and extended by `apply-honest-scope` and
  `propose-planning-only` — with the open-pr slice: a tested-push predicate,
  source-level assertions that both open-pr getters render one shared body
  carrying the guardrails, a render loop over every registered agent's open-pr
  skill and command output, and unit cases proving the assertions reject the
  pre-change body shape (features:
  `lifecycle-honesty/open-pr-rendered-output.feature`). The existing verify,
  apply, and propose slices stay green untouched.
- Documents the tested-push behavior on open-pr's three existing documented
  surfaces (per the `documentation` standard): `README.md`'s "PR grouping"
  prose and its whole-batch PR-flow Mermaid diagram,
  `docs/engine/agent-runtime.md`'s "PR step" overview diagram and its
  `runPrStep` summary prose, and `docs/configuration/generated-artifacts.md`'s
  `open-pr` paragraph — each currently says the agent commits, pushes, and
  opens one PR, behavior this change gates on a fresh green test run.

## Design

- **One author of lifecycle text (delegated-lifecycle).** Every guardrail
  lands in the single `OPEN_PR_BODY` constant in
  `src/core/templates/workflows/open-pr.ts`; both getters already consume it,
  so no collapse is needed and the skill and command cannot drift. The one
  engine edit is the PR-step delegation guidance (`prDelegationGuidance` in
  `src/core/batch/engine/instructions.ts`): it stops re-describing the
  commit/push/PR-open lifecycle the shared body authors and keeps only the
  invocation token, the standards-loading sentence, and the
  delegate-to-the-skill wording — so the tested-push rules live in exactly one
  place and the engine prompt cannot drift from them. The engine keeps
  delegating the PR step to the canonical `/rct:open-pr` command and keeps
  journaling a commit/push/PR-open failure as a reported step failure — a
  stopped (red, undiscoverable, or rejected-push) step simply produces no pr
  completion, so a later run retries, which is exactly the existing failure
  path the engine already records.
- **The tested tree is the pushed tree.** The test step sits between commit
  and push and runs on the committed tree — the exact commit that will be
  pushed — so the pushed tree and the PRed tree are always the tested tree,
  never a drifted or stale one. A red, unrun, or undiscoverable test result
  stops the step before any push, which is what makes "never opens the PR on
  red" true rather than aspirational.
- **Same discovery rule as verify, same wording.** Test-command discovery
  reuses the verify workflow's rule verbatim (the project's own manifest test
  script, Makefile test target, or CI configuration; no new ratchet
  configuration; no assumed toolchain), so the two lifecycle surfaces cannot
  diverge on what "the project's own test command" means. Where verify records
  the case as "Not verified" / CRITICAL in a report, open-pr's equivalent is
  STOP and report — the spawned PR agent has no user to ask mid-step, so every
  failure mode is a reported stop, never an ask and never a silent fallback.
- **Never force-push; never retry a rejection.** The push step names the
  force-push ban explicitly (`--force` / `--force-with-lease`, under any
  circumstances) and makes a rejected push a stop-and-report event: the remote
  said no, and the honest outcome is a reported step failure the engine
  journals, not a retry loop or a force. This keeps the run-state semantics
  unchanged — no pr completion is recorded, the group stays retryable.
- **Enforcement at the unit layer (testing standard).** The open-pr slice
  appends to `test/core/shared/lifecycle-honesty.test.ts`, mirroring the
  verify/apply/propose slices: pure string predicates over a rendered open-pr
  body for each guardrail (discover the project's own test command with no new
  ratchet configuration; run it fresh on the committed tree before pushing;
  stop on red/unrun/undiscoverable with no push and no PR; never force-push;
  stop and report a rejected push instead of retrying; output cites the exact
  command and fresh result), source-level assertions that `open-pr.ts` keeps
  one `OPEN_PR_BODY` consumed by both getters and that both getters render the
  tested-push text, a render loop over every open-pr skill template
  (`getSkillTemplates(['open-pr'])` / `generateSkillContent`) and command
  template (`getCommandContents(['open-pr'])` / per-adapter `generateCommand`)
  for each agent in the supported-tools registry (`AI_TOOLS`,
  `CommandAdapterRegistry`) asserting the checked agent set is non-empty and
  equal to the registry length, and unit cases feeding the predicate the
  pre-change body shape (commit → push → open PR with no test run, no
  force-push rule, no rejected-push rule) and asserting rejection. The file
  header is updated to also name `open-pr-tested-push/tested-push.feature` and
  `lifecycle-honesty/open-pr-rendered-output.feature`.
- **Per-agent outputs covered (multi-agent-support).** The open-pr skill
  renders to `<skillsDir>/skills/ratchet-open-pr/SKILL.md` for every registry
  agent (`.claude`, `.codex`, `.cursor`, `.gemini`, `.github`, `.opencode`);
  the command renders to each adapter's path
  (`.claude/commands/rct/open-pr.md`, `<CODEX_HOME>/prompts/rct-open-pr.md`,
  `.cursor/commands/rct-open-pr.md`, `.gemini/commands/rct-open-pr.md`,
  `.github/prompts/rct-open-pr.prompt.md`,
  `.opencode/commands/rct/open-pr.md`). The render loop iterates the registry,
  so a newly registered agent is covered automatically. The new prose is plain
  stop-and-report text with no agent-specific tool references (keeping
  `agent-neutral-rendered-output.test.ts` green); the spawned PR agent reports
  rather than asks, so no capability-plus-fallback phrasing is needed.
- **Static body, no new dynamic inputs (instruction-fed-config).** The
  guardrails are static template text; the PR-step instructions payload (the
  work/base branch Input) is unchanged, no config is read, and no payload keys
  are added.
- **No shipped toolchain literals (generalizable-defaults).** The new prose
  names no test command, package manager, or tool-specific path — discovery is
  described as reading what the project declares, never as a ratchet-specific
  command string.
- **Verification.** `pnpm vitest run test/core/shared/lifecycle-honesty.test.ts`
  is green (the open-pr slice plus the pre-existing verify, apply, and propose
  slices); `agent-neutral-rendered-output.test.ts` stays green; and per the
  testing standard the full suite (`pnpm test`) and the coverage gate
  (`pnpm test:coverage`) stay green. This change owns the phase
  proof-of-work's `force-push` grep half against
  `src/core/templates/workflows/open-pr.ts` (the `Not verified` half belongs
  to the already-applied `verify-honest-report`); with all four slices in the
  shared test file green, the phase proof-of-work passes.

## Tasks

- [x] 1.1 In `src/core/templates/workflows/open-pr.ts`, add the test-gate step
  to `OPEN_PR_BODY` between the commit step and the push step: discover the
  project's own test command from the project itself (package manifest test
  script, Makefile test target, CI configuration, or whatever the project
  already declares) with no new ratchet configuration and no assumed
  toolchain, and run it fresh on the committed tree — the exact commit that
  will be pushed — before any push (features:
  `open-pr-tested-push/tested-push.feature`)
- [x] 1.2 Add the stop conditions to the test step: a failing fresh run STOPs
  and reports the exact command and its failing result (never push a red
  tree, never open the pull request on a red or unrun test result); no
  discoverable test command or a run that cannot complete STOPs and reports
  the reason — the pull request is opened only on a fresh green run
- [x] 1.3 Add the push rules to the push step and the Guardrails: never
  force-push under any circumstances (no `git push --force`, no
  `--force-with-lease`); on a rejected push STOP and report the remote's
  rejection instead of retrying the push or forcing it — the engine surfaces
  it as a reported step failure
- [x] 1.4 Update the output summary in `OPEN_PR_BODY` to cite the exact test
  command discovered and run and its fresh green result alongside the commit
  style, the commit, the pushed branch, and the single pull request opened
- [x] 1.5 In `src/core/batch/engine/instructions.ts`, trim
  `prDelegationGuidance` so it stops re-describing the lifecycle the shared
  open-pr body authors: delete the sentences directing the agent to read
  `git log` for commit style, commit the accumulated work, push the work
  branch, and open EXACTLY ONE pull request via the forge CLI, and keep only
  the rct open-pr invocation token, the standards-loading sentence, and the
  "delegate to the skill / Do NOT hand-build or re-describe the PR-open steps"
  wording, with the work/base Input from `prInputContext` unchanged. Add a
  unit test in `test/batch-engine/pr-spawn-at-completion.test.ts` asserting
  the PR prompt contains the invocation, the Do-NOT-hand-build wording, and
  the branches, and does NOT match `git log`, `accumulated work`, `push the
  work branch`, or `forge CLI`
- [x] 2.1 Extend `test/core/shared/lifecycle-honesty.test.ts` with the open-pr
  slice (header naming `open-pr-tested-push/tested-push.feature` and
  `lifecycle-honesty/open-pr-rendered-output.feature`): a tested-push
  predicate over a rendered open-pr body, source-level assertions that
  `open-pr.ts` keeps one `OPEN_PR_BODY` consumed by both getters and that both
  getters render the tested-push text, a render loop over every open-pr skill
  and command template for every registered agent asserting the predicates
  hold and the checked agent set is non-empty and equal to the registry
  length, and unit cases asserting the predicate rejects the pre-change body
  shape (no test run, no force-push rule, no rejected-push rule)
- [x] 2.2 Run `pnpm vitest run test/core/shared/lifecycle-honesty.test.ts`
  and `pnpm vitest run test/core/shared/agent-neutral-rendered-output.test.ts`;
  both must pass. Also run the batch-engine tests (`pnpm vitest run
  test/batch-engine/pr-spawn-at-completion.test.ts`) — the task 1.5 unit test
  lives there and the existing PR-spawn tests must stay green. Per the testing
  standard, also run the full suite
  (`pnpm test`) and the coverage gate (`pnpm test:coverage`); both must be
  green. Then run the phase proof-of-work (`pnpm vitest run
  test/core/shared/lifecycle-honesty.test.ts && grep -q 'Not verified'
  src/core/templates/workflows/verify-change.ts && grep -qi 'force-push'
  src/core/templates/workflows/open-pr.ts`); it must exit zero
- [x] 3.1 Documentation (per the `documentation` standard — open-pr's behavior
  is documented on three existing surfaces, and each describes the
  commit/push/PR-open flow this change gates):
  - `README.md` "PR grouping" section: the `/rct:open-pr` summary prose gains
    the test gate (runs the project's own discovered test command on the
    committed tree first; a red, unrun, or undiscoverable result is a reported
    step failure — never pushed, never PRed) and the push rules (never
    force-push; a rejected push is reported, not retried); the whole-batch
    PR-flow Mermaid `flowchart TD` gains the test-gate node and the
    red/rejected failure edges (every `classDef` keeps `color:` and
    high-contrast fills with semantic Unicode labels, matching the diagram's
    existing style).
  - `docs/engine/agent-runtime.md` "PR step" section: the `runPrStep` summary
    prose and the overview Mermaid `flowchart TD` gain the same test gate and
    push rules — the engine-side description stays an accurate summary of the
    `/rct:open-pr` body it delegates to (the engine itself is unchanged).
  - `docs/configuration/generated-artifacts.md`: the `open-pr` paragraph
    gains the tested-push clause (commits in the repo's `git log` style, runs
    the project's own discovered test command fresh on the committed tree,
    pushes only a green tree — never force-pushing and stopping on a rejected
    push — and opens exactly one forge-agnostic PR).
