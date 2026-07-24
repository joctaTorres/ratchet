Feature: Proof-of-work phase gate, end to end
  As a ratchet maintainer
  I want a blackbox e2e that drives the real `ratchet batch apply`
  So that `proofOfWork: hard-gate` is proven to actually block a phase boundary,
  not merely modeled

  # The e2e (`test/e2e/proof-of-work-gate.sh`) builds the package and drives the
  # BUILT CLI as a child process (`node bin/ratchet.js batch apply`) against a
  # committed two-phase fixture batch copied into a fresh scratch project root.
  # Phase 1 is already done (its change is archived) and phase 2 holds an
  # outstanding change, so the first apply runs phase 1's CONFIGURED
  # proof-of-work at the boundary. The fixture's proof-of-work passes or fails
  # purely on an environment signal the script controls, so no real agent is
  # ever spawned. The script writes a machine-readable result and exits 0 only
  # when every scenario below holds.

  Background:
    Given the package is built so `bin/ratchet.js` is runnable
    And a fresh scratch project root containing the two-phase fixture batch
    And phase 1's change is archived so phase 1 is done and phase 2 is outstanding

  Scenario: A failing hard-gate proof blocks entry into the next phase
    Given the fixture's proof-of-work policy is "hard-gate"
    And the environment makes phase 1's proof-of-work command fail
    When `ratchet batch apply` runs the phase-1 boundary proof-of-work
    Then the proof-of-work verdict is recorded as failed and not gate-passed
    And a second `ratchet batch apply` does not advance into phase 2
    But reports no ready step, citing phase 1's failing proof-of-work as the reason
    And `ratchet batch status` reports phase 2 as gated with a report naming the failing proof

  Scenario: The same fixture advances once the proof passes
    Given the fixture's proof-of-work policy is "hard-gate"
    And the environment makes phase 1's proof-of-work command pass
    When `ratchet batch apply` runs the phase-1 boundary proof-of-work
    Then the proof-of-work verdict is recorded as passed and gate-passed
    And `ratchet batch status` reports phase 2 as not gated
    And the batch's next step points at phase 2's outstanding change

  Scenario: Warn mode advances while surfacing the failure
    Given the fixture's proof-of-work policy is "warn"
    And the environment makes phase 1's proof-of-work command fail
    When `ratchet batch apply` runs the phase-1 boundary proof-of-work
    Then the proof-of-work verdict is recorded as failed but gate-passed
    And the apply output surfaces the failure as a warning, not a hard stop
    And `ratchet batch status` reports phase 2 as not gated so the batch advances
