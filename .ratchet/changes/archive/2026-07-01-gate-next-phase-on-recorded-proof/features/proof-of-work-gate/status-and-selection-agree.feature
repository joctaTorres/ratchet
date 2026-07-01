Feature: Status and selection agree on the proof-derived gate
  As the ratchet batch host loop
  I want batch status and step selection to derive the prior-phase gate from the same recorded proof
  So that what status reports as blocked is exactly what selection refuses to run, by construction

  Background:
    Given a batch with phase "p1" followed by phase "p2"
    And the batch's resolved proof-of-work policy is "hard-gate"
    And every change in phase "p1" is done
    And phase "p2" has an outstanding change

  Scenario: A failing recorded proof makes status and selection agree the next phase is gated
    Given a proof-of-work outcome has been recorded for phase "p1" with gatePassed false
    When the batch status is computed
    Then phase "p2" is reported as blocked by phase "p1"
    And selecting the next runnable step from that same status yields no runnable change in phase "p2"

  Scenario: A passing recorded proof makes status and selection agree the next phase is reachable
    Given a proof-of-work outcome has been recorded for phase "p1" with gatePassed true
    When the batch status is computed
    Then phase "p2" is not reported as blocked
    And selecting the next runnable step from that same status yields phase "p2"'s outstanding change

  Scenario: The gate is derived from the recorded outcome, not from "all changes done" alone
    Given every change in phase "p1" is done
    And a proof-of-work outcome has been recorded for phase "p1" with gatePassed false
    When the batch status is computed
    Then phase "p2" is blocked even though every change in phase "p1" is done
