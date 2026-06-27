Feature: propose → apply → verify completes the headless loop on one change
  As the apply and verify verbs sitting on the change-scoped engine core
  I want each verb to run exactly one forced transition via runChangeStep and
  leave `ratchet batch apply` untouched
  So that a single change can move through the whole loop with no batch manifest
  while the batch path keeps deriving its own transition

  Background:
    Given a project with no batch manifest selected
    And an injected agent runtime so no real agent is spawned

  Scenario: The full loop drives three forced single-step transitions
    Given no change directory ".ratchet/changes/doctor-cmd/" exists
    When I run `ratchet propose "Add a doctor command" --name doctor-cmd`
    And the proposed change now has a plan.md
    And I run `ratchet apply doctor-cmd` until its tasks are all done
    And I run `ratchet verify doctor-cmd`
    Then each verb spawned exactly one agent for its own forced transition
    And every transition was forced, never re-derived via computeNextTransition
    And all run state lived under ".ratchet/changes/doctor-cmd/.run/"

  Scenario: A clean agent exit reports advancement; a failure stays resumable
    Given a change ".ratchet/changes/doctor-cmd/" with a plan.md
    And an injected runtime whose agent records a completion and exits zero
    When I run `ratchet apply doctor-cmd`
    Then the command reports the change advanced through apply
    But given instead an agent that exits non-zero without completing
    Then the command surfaces a blocked result that remains resumable

  Scenario: Batch apply is untouched by the new verbs
    Given a batch manifest that references a change
    When I run `ratchet batch apply`
    Then it still calls engine.runStep with a manifest-resolved batch context
    And it still derives its own transition via computeNextTransition
    And the new apply/verify verbs do not alter that path
