Feature: `ratchet verify <change>` verifies one change headlessly
  As a developer who finished implementing a change and wants it checked
  I want a first-class `ratchet verify <change>` verb that forces the verify
  transition and spawns exactly one agent via runChangeStep
  So that I can verify a single change from the CLI with no batch manifest,
  completing the headless propose → apply → verify loop

  Background:
    Given a project with no batch manifest selected
    And an injected agent runtime so no real agent is spawned

  Scenario: Verify forces the verify transition and runs one agent
    Given a change ".ratchet/changes/doctor-cmd/" whose plan tasks are ALL done
    When I run `ratchet verify doctor-cmd`
    Then runChangeStep is called with a ChangeStepContext whose transition is "verify"
    And the forced verify transition is NOT re-derived via computeNextTransition
    And the context carries no batch, so the run-state locus is change-local
    And exactly one agent is spawned for the forced verify transition

  Scenario: Verify errors when tasks are not all done
    Given a change ".ratchet/changes/doctor-cmd/" with an unchecked "- [ ]" task
    When I run `ratchet verify doctor-cmd`
    Then the command fails with an actionable error that tasks are not all done
    And the error hints that `ratchet apply` should finish them, or to pass --force
    And no agent is spawned

  Scenario: --force overrides the unfinished-tasks precondition
    Given a change ".ratchet/changes/doctor-cmd/" with an unchecked "- [ ]" task
    When I run `ratchet verify doctor-cmd --force`
    Then the unfinished-tasks precondition is bypassed
    And exactly one agent is spawned for the forced verify transition

  Scenario: Verify errors when the change does not exist
    Given no change directory ".ratchet/changes/ghost/" exists
    When I run `ratchet verify ghost`
    Then the command fails with an actionable error that the change does not exist
    And no agent is spawned

  Scenario: -m guidance is appended to the verify instructions
    Given a change ".ratchet/changes/doctor-cmd/" whose plan tasks are ALL done
    When I run `ratchet verify doctor-cmd -m "double-check the error paths"`
    Then the built instructions include the appended guidance "double-check the error paths"
    And exactly one agent is spawned

  Scenario: Run state resumes from the change-local .run directory
    Given a change ".ratchet/changes/doctor-cmd/" whose plan tasks are ALL done
    When I run `ratchet verify doctor-cmd`
    Then the journal is read from ".ratchet/changes/doctor-cmd/.run/journal.jsonl"
    And the outcome entry is written under the same change-local .run directory
    And nothing is written under ".ratchet/batches/"
