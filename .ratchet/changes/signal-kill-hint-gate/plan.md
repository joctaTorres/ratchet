# signal-kill-hint-gate

## Why

The model-failure attribution hint ("if this model id is invalid or not
available to this agent, correct the `agent` setting…") is meant for the
argv-rejection signature: an agent that rejected its own argv and exited with a
real non-zero exit code before writing any journal entry. But `mapSessionToOutcome`
computes the failure branch off `nonZero = spawn.exitCode !== 0 || spawn.signal !== null`
and gates the hint only on `input.modelAttribution && sessionEntries.length === 0`.
A signal-killed spawn — e.g. a `timeout` SIGKILL, or an OOM kill — has
`exitCode: null, signal: 'SIGKILL'` and writes no journal entries, so under an
explicit-model spec it falsely gets the "model id may be invalid" hint even
though the model was valid and the agent was killed externally. That misdirects
the operator into "fixing" a model id that was never the problem.

## What Changes

- Gate the attribution hint in `mapSessionToOutcome` on a **real non-zero exit
  code**: the hint fires only when `spawn.signal === null` (a genuine exit code),
  in addition to the existing `modelAttribution && sessionEntries.length === 0`
  conditions. A signal kill under a valid explicit model surfaces its failure —
  blocked, resumable, stderr tail intact — on every rendered surface WITHOUT the
  hint, naming the signal via the existing `describeExit` ("via signal SIGKILL").
- Exit-code fast-failures (code ≠ 0, no signal, zero journal entries) keep the
  hint byte-for-byte — no regression to finding-1/finding-5 attribution.
- Update the argv-rejection prose in `docs/engine/overview.md`,
  `docs/commands/batch.md`, and `README.md` to state the hint fires only on a
  real non-zero exit code, never on a signal kill.

## Design

**The single-line gate.** `mapSessionToOutcome` already enters the failed branch
for any `nonZero && !completion`, where `nonZero = exitCode !== 0 || signal !== null`.
A signal kill (`exitCode: null, signal: 'SIGKILL'`) enters that branch and takes
today's bare failure shape — except the attribution sub-branch fires on
`input.modelAttribution && sessionEntries.length === 0`, which a signal kill also
satisfies. The fix adds `&& spawn.signal === null` to that sub-branch condition.
Within the failed branch, `signal === null` implies a numeric non-zero exit code
(node's `close` event always yields exactly one of exitCode/signal), so this
gate is exactly "the hint requires a real non-zero exit code" — matching the
Definition of done. No new field, no new type: the `AgentSpawnResult.signal`
already carried on `spawn` is the discriminator. The bare-failure fallback
(no hint, `describeExit` naming the signal) already handles the signal-kill
output correctly — the only change is to stop entering the hint sub-branch.

**Why not treat a signal kill as a distinct outcome state.** A signal-killed
agent is still a failed, resumable step exactly like an exit-code failure — the
operator reviews and resumes. The only defect is the *misleading hint*, so the
minimal correct fix is narrowing the hint gate, not adding an outcome shape.
Every non-hint surface (state `blocked`, the stderr tail, `describeExit`) is
already correct for a signal kill.

**Comment/docstring accuracy.** The `MapOutcomeInput.modelAttribution` docstring
and the in-branch comment currently describe the trigger as "a non-zero exit
without a completion AND zero session journal entries". Both are updated to say
"a real non-zero exit code (not a signal kill)" so the code's contract matches
its behavior (per the `documentation` standard's accuracy bar applied to
source-level reference comments).

Standards embedded:
- **testing** — the gate is a pure branch in `mapSessionToOutcome`, so the
  primary proof is at the **unit** layer (`test/batch-engine/outcome.test.ts`),
  with the phase proof-of-work suite (`model-failure-attribution.test.ts`)
  asserting the gate on **rendered** surfaces (detail/blocker/message + the
  `renderStepResult` stdout blocked line), per "test the right thing at the right
  layer" and "assert on observable output". Both the signal-kill (no hint) and
  the exit-code (keeps hint) cases are asserted, and the full suite + 95%
  coverage floor stay green. Each test file already names its `.feature` in its
  header; the new scenarios extend that header note.
- **documentation** — a mandatory, blocking documentation task updates the
  Reference prose that today describes the argv-rejection signature as "non-zero
  exit" (`docs/engine/overview.md` failure-mapping item 4, `docs/commands/batch.md`
  "Attributed fast failures", and the `README.md` attribution sentence) to state
  the hint requires a real non-zero exit code and is suppressed on a signal kill.
- **delegated-lifecycle / multi-agent-support / generalizable-defaults /
  instruction-fed-config** — untouched: no lifecycle instruction text, no
  agent-registry, no config-key, and no default is added or changed; the fix is a
  single tool-agnostic branch condition over the existing `AgentSpawnResult`.

## Tasks

- [x] 1.1 Add a failing **unit** test in `test/batch-engine/outcome.test.ts`: a
  signal-killed spawn (`spawn({ exitCode: null, signal: 'SIGKILL' })`) with a
  `modelAttribution` and zero session entries maps to `blocked` with NO hint —
  `detail`/`blocker`/`message` carry no "if this model id is invalid" text and
  name the signal ("via signal SIGKILL") — while the existing exit-code
  attributed mapping (code 2, no signal) still carries the hint
  (signal-kill-hint-gate.feature)
- [x] 1.2 Add a failing unit assertion in the same file that a signal kill with
  `modelAttribution: undefined` (scope-less) deep-equals a signal kill's
  today-baseline output, proving the gate change touches only the hint sub-branch
  (signal-kill-hint-gate.feature)
- [x] 1.3 Add failing **rendered-surface** tests in
  `test/batch-engine/model-failure-attribution.test.ts`: extend the fake spawner
  with a `signal-kill` mode returning `{ exitCode: null, signal: 'SIGKILL', stderr }`;
  drive an explicit-model transition with threaded `agentStageScopes` and assert
  the result is `blocked`, carries no hint on `detail`/`blocker`/`message`, names
  the signal, keeps the stderr tail, and that `renderStepResult` stdout shows the
  blocked line via-signal with no attribution hint; assert an exit-code
  fast-failure still renders the hint (regression guard) (signal-kill-hint-gate.feature)
- [x] 2.1 Implement the gate in `mapSessionToOutcome`
  (`src/core/batch/engine/outcome.ts`): add `&& spawn.signal === null` to the
  attribution sub-branch condition so the hint fires only on a real non-zero exit
  code; update the `MapOutcomeInput.modelAttribution` docstring and the in-branch
  comment to state the trigger requires a real non-zero exit code (not a signal
  kill); tests from 1.1–1.3 pass
- [x] 3.1 Documentation (per the `documentation` standard / `documentation` tag):
  update `docs/engine/overview.md` failure-mapping item 4, `docs/commands/batch.md`
  "Attributed fast failures", and the `README.md` attribution sentence (~line 211)
  to state the attribution hint requires a **real non-zero exit code** and is
  suppressed on a signal kill (e.g. a `timeout` SIGKILL) even under an explicit model
- [x] 4.1 Run the phase proof (`pnpm test test/batch-engine/model-failure-attribution.test.ts`)
  and the full suite with coverage (`pnpm test`), confirming the attribution suite
  is green including the new signal-kill rendered-surface assertions and that
  neither the existing suites nor the 95% coverage floor regress
