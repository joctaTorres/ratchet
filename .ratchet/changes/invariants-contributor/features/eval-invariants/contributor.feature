Feature: Invariants gate contributor
  As ratchet's eval gate
  I want the loaded invariant manifest's active invariants evaluated run-level as
  the `invariants` contributor in the verdict-aggregation core
  So that an anti-gaming invariant the run violates — or one that cannot be
  evaluated at all — hard-fails the run as a sibling to regression, while inert
  invariants are skipped rather than counted as vacuous passes

  # This is the contributor-wiring slice of the invariant set. The prior slices
  # gave the gate a fail-closed manifest loader (`loadInvariantManifest`) and a
  # per-invariant evaluator (`evaluateInvariant` / `isInvariantViolation`); the
  # `invariants` contributor in `aggregate.ts` is still a neutral placeholder that
  # always passes. This slice makes the contributor real: at the single run-level
  # aggregation seam (`buildReport`) the manifest's ACTIVE invariants are
  # evaluated and reduced to one pass/fail outcome that takes part in the AND over
  # contributors. Writing the default `.ratchet/evals/invariants.yaml` manifest at
  # `ratchet init` is a separate downstream change and is out of scope here.

  Background:
    Given the verdict-aggregation core decides a run's pass as a logical AND over named contributors
    And the built-in contributors are deterministic, llm-judge, invariants, and regression
    And a checked-in ".ratchet/evals/invariants.yaml" manifest the loader resolves for the run

  # --- run-level gating over the manifest's ACTIVE invariants -----------------

  Scenario: An active invariant the run satisfies leaves the run passing
    Given a manifest whose only active invariant evaluates to pass against the run
    When an eval run is reported with every contributor enabled
    Then the invariants contributor reports pass
    And the overall verdict is decided by the AND over contributors

  Scenario: A violated active invariant hard-fails the run
    Given a manifest with an active invariant the run violates
    When an eval run is reported with every contributor enabled
    Then the invariants contributor reports fail and names the violated invariant
    And the overall verdict is fail because the AND over contributors includes the invariants contributor

  Scenario: An inert invariant is skipped, never a vacuous pass
    Given a manifest with one inert invariant and no active invariants
    When an eval run is reported with every contributor enabled
    Then the inert invariant is not evaluated
    And the invariants contributor reports pass because there is nothing active to evaluate
    And the inert invariant is not counted as a passing invariant

  # --- fail-closed: unevaluable active invariant, and an unloadable manifest ---

  Scenario: An active invariant that cannot be evaluated fails the run closed
    Given a manifest with an active invariant the evaluator reports unevaluable
    When an eval run is reported with every contributor enabled
    Then the invariants contributor reports fail and names the unevaluable invariant
    And the unevaluable invariant counts as a violation, not a pass

  Scenario: A manifest that cannot be loaded fails the run closed
    Given a present but malformed ".ratchet/evals/invariants.yaml" the loader rejects
    When an eval run is reported with the invariants contributor enabled
    Then the invariants contributor reports fail rather than passing on an empty set
    And the failure records that the manifest could not be loaded

  Scenario: An absent manifest leaves the invariants contributor passing
    Given no ".ratchet/evals/invariants.yaml" manifest in the project
    When an eval run is reported with every contributor enabled
    Then the invariants contributor reports pass because no invariants are declared

  # --- a violated invariant is surfaced first, as a sibling to regression -----

  Scenario: A violated invariant is surfaced first as a sibling to regression
    Given a run that both violates an active invariant and regresses a baseline case
    When the eval run result is rendered
    Then the run-level invariant violation is surfaced first as a sibling to the regression
    And both are surfaced ahead of the per-case failures

  # --- toggle via eval.gate.invariants / --no-invariants ----------------------

  Scenario: eval.gate.invariants false disables the contributor for the run
    Given ".ratchet/config.yaml" sets eval.gate.invariants to false
    When the contributor gate is resolved for an eval run with no CLI override
    Then the invariants contributor is disabled
    And the deterministic, llm-judge, and regression contributors remain enabled

  Scenario: --no-invariants disables the contributor from the CLI
    Given a project whose eval.gate config leaves every contributor enabled
    When "ratchet eval run --no-invariants" resolves the contributor gate
    Then the invariants contributor is disabled for that run
    And the CLI flag overrides the config default

  Scenario: A disabled invariants contributor is not evaluated and takes no part in the verdict
    Given a manifest with an active invariant the run violates
    When "ratchet eval run --no-invariants" reports the run
    Then no invariant is evaluated
    And the invariants contributor takes no part in the AND over contributors
