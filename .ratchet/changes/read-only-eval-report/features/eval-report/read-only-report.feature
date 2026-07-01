Feature: Read-only eval report
  As ratchet's eval surface
  I want `eval report` to render a run's verdict purely from persisted state
  So that reporting a run never re-evaluates the invariant gate — never runs a
  check command, never spawns a mutation-seeding agent, and never mutates the
  working tree — while `eval run` remains the one place the gate is evaluated

  # The run-level invariant gate is evaluated inside a single seam that BOTH
  # `eval run` and `eval report` route through today. Evaluating an active
  # `mutation` invariant on a cache miss spawns a coding agent and, through the
  # mutation harness, `git reset --hard` / `git clean -fd`s the tree — so the
  # read-only `eval report` verb can spawn and mutate. This change splits the two
  # responsibilities: `evaluateRun` (run path) evaluates the gate WITH the spawner
  # and PERSISTS the full result onto the run; `renderReport` (report path) is
  # PURE and reads the persisted result. A run whose gate was never persisted
  # (invariants disabled, or a legacy run predating this change) renders its
  # invariants as a neutral "not evaluated" state that never re-evaluates and never
  # affects the pass/fail gate.

  Background:
    Given the run-level invariant gate is evaluated by `evaluateInvariantGate` with a spawner
    And the verdict-aggregation core decides a run's verdict as an AND over contributors
    And an eval run is persisted under `.ratchet/evals/runs/<run-id>.json`

  # --- the run path evaluates the gate and persists its full result ------------

  Scenario: eval run evaluates the invariant gate and persists its full result onto the run
    Given a project whose active invariant gate the run evaluates with the spawner
    When the run path builds the report for the run
    Then the invariant gate is evaluated once with the spawner
    And the full gate result — the per-invariant outcomes and the gate pass/fail — is persisted onto the run
    And the report exposes the per-invariant breakdown and the overall verdict

  Scenario: eval run behavior is preserved exactly, still gating and persisting the mutation evidence
    Given an active mutation invariant whose harness seeds a surviving mutant through the spawner
    When the run path builds the report for the run
    Then the invariants contributor fails on the surviving mutant
    And every mutant the harness ran is persisted as durable run evidence
    And the overall verdict is fail

  # --- the report path is pure: never evaluates, spawns, or mutates ------------

  Scenario: eval report on a run with an active mutation invariant does not spawn and does not mutate the tree
    Given a run whose project declares an active mutation invariant
    And an injected fake spawner that counts how many times it is called
    When the report path renders the report for the run
    Then the fake spawner is called zero times
    And the working tree is left exactly as it was — no `git reset --hard` and no `git clean -fd`
    And no invariant check command is run

  Scenario: run then report shows the same verdict as run alone
    Given the run path has evaluated an active invariant gate and persisted its result
    When the report path renders the same run
    Then it reads the persisted gate result rather than re-evaluating it
    And the report's overall verdict equals the verdict the run path produced
    And the report's per-invariant breakdown equals the persisted one

  # --- "not evaluated": disabled invariants, or a legacy run -------------------

  Scenario: a run whose invariants contributor was disabled renders invariants as not evaluated
    Given a run whose gate excludes the invariants contributor
    When the report path renders the report for the run
    Then the invariants are rendered in a neutral "not evaluated" state
    And the not-evaluated invariants are not re-evaluated
    And the not-evaluated invariants do not affect the pass/fail gate

  Scenario: a legacy run persisted before gate persistence renders invariants as not evaluated without crashing
    Given a run whose gate includes invariants but that carries no persisted gate result
    And a present but malformed invariant manifest the report path must never load
    When the report path renders the report for the run
    Then the invariants are rendered in a neutral "not evaluated" state
    And the malformed manifest is never loaded and no load error is reported
    And the report does not crash and the overall verdict is unaffected by the invariants
