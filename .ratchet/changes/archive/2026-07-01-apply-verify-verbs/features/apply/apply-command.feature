Feature: `ratchet apply <change>` advances one change headlessly
  As a developer who proposed a change and now wants it implemented
  I want a first-class `ratchet apply <change>` verb that forces the apply
  transition and spawns exactly one agent via runChangeStep
  So that I can implement a single change from the CLI with no batch manifest,
  mirroring `ratchet propose` but for the apply step of the loop

  Background:
    Given a project with no batch manifest selected
    And an injected agent runtime so no real agent is spawned

  Scenario: Apply forces the apply transition and runs one agent
    Given a change directory ".ratchet/changes/doctor-cmd/" with a plan.md
    When I run `ratchet apply doctor-cmd`
    Then runChangeStep is called with a ChangeStepContext whose transition is "apply"
    And the forced apply transition is NOT re-derived via computeNextTransition
    And the context carries no batch, so the run-state locus is change-local
    And exactly one agent is spawned for the forced apply transition

  Scenario: Apply errors when the change has no plan
    Given a change directory ".ratchet/changes/doctor-cmd/" with NO plan.md
    When I run `ratchet apply doctor-cmd`
    Then the command fails with an actionable error that the change has no plan
    And the error hints that `ratchet propose` must run first, or to pass --force
    And no agent is spawned

  Scenario: --force overrides the missing-plan precondition
    Given a change directory ".ratchet/changes/doctor-cmd/" with NO plan.md
    When I run `ratchet apply doctor-cmd --force`
    Then the missing-plan precondition is bypassed
    And exactly one agent is spawned for the forced apply transition

  Scenario: Apply errors when the change does not exist
    Given no change directory ".ratchet/changes/ghost/" exists
    When I run `ratchet apply ghost`
    Then the command fails with an actionable error that the change does not exist
    And no agent is spawned

  Scenario: -m guidance is appended to the apply instructions
    Given a change directory ".ratchet/changes/doctor-cmd/" with a plan.md
    When I run `ratchet apply doctor-cmd -m "start with the parser task"`
    Then the built instructions include the appended guidance "start with the parser task"
    And exactly one agent is spawned

  Scenario: Settings are resolved standalone (flag → project config → default)
    Given .ratchet/config.yaml sets batch locus "docker" and image "node:20"
    And a change directory ".ratchet/changes/doctor-cmd/" with a plan.md
    When I run `ratchet apply doctor-cmd --locus local`
    Then the resolved settings come from resolveChangeStepSettings, not a manifest
    And the explicit locus flag "local" wins over the project config "docker"

  Scenario: Run state resumes from the change-local .run directory
    Given a change directory ".ratchet/changes/doctor-cmd/" with a plan.md
    When I run `ratchet apply doctor-cmd`
    Then the journal is read from ".ratchet/changes/doctor-cmd/.run/journal.jsonl"
    And the outcome entry is written under the same change-local .run directory
    And nothing is written under ".ratchet/batches/"
