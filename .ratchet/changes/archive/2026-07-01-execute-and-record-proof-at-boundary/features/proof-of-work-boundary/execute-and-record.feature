Feature: Execute and record a phase's proof-of-work at the boundary
  As the ratchet batch host loop
  I want to run the prior phase's proof-of-work when crossing into a phase that still has work
  So that the proof-of-work command actually executes and its verdict is recorded durably

  Background:
    Given a batch with phase "p1" followed by phase "p2"
    And phase "p1" declares a proof-of-work command and pass condition
    And the batch's resolved proof-of-work policy is "hard-gate"

  Scenario: Running the prior phase's proof-of-work when entering a phase with outstanding work
    Given every change in phase "p1" is done
    And phase "p2" has an outstanding change
    And no proof-of-work outcome has yet been recorded for phase "p1"
    When "ratchet batch apply" runs
    Then it runs phase "p1"'s proof-of-work command in the project root
    And it passes the resolved policy and phase "p1"'s success criteria to the run
    And it journals a ProofOfWorkResult carrying the phase, passed, gatePassed, policy, reason, and detail
    And the recorded outcome's phase is "p1"

  Scenario: A failing proof is recorded with a clear report (without this step itself blocking)
    Given every change in phase "p1" is done
    And phase "p2" has an outstanding change
    And phase "p1"'s proof-of-work command fails
    When "ratchet batch apply" runs at the boundary
    Then it journals a ProofOfWorkResult for phase "p1" with passed false
    And the recorded detail explains why the proof failed
    But selecting and blocking the next phase on this recorded outcome is left to a later capability

  Scenario: The proof runs at most once per boundary
    Given a proof-of-work outcome has already been recorded for phase "p1" at the boundary into phase "p2"
    When "ratchet batch apply" runs again
    Then it does not re-run phase "p1"'s proof-of-work command
    And it proceeds to select phase "p2"'s outstanding change

  Scenario: The first phase has no prior-phase proof to run
    Given phase "p1" itself has an outstanding change
    And no phase precedes "p1"
    When "ratchet batch apply" runs
    Then no proof-of-work command is run
    And phase "p1"'s outstanding change is selected as the next step

  Scenario: The proof-of-work command is the phase's configured command, not a ratchet default
    Given phase "p1"'s configured proof-of-work command is the project's own command
    When the boundary proof-of-work runs
    Then ratchet executes that configured command in the project root
    And ratchet injects no hardcoded package manager, test runner, or command string of its own
