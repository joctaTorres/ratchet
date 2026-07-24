Feature: Hard-gate blocks the next phase on a recorded failing proof-of-work
  As the ratchet batch host loop
  I want the prior-phase gate to consult the recorded proof-of-work verdict
  So that under hard-gate a phase cannot be entered until the prior phase's proof actually passed

  Background:
    Given a batch with phase "p1" followed by phase "p2"
    And the batch's resolved proof-of-work policy is "hard-gate"
    And every change in phase "p1" is done
    And phase "p2" has an outstanding change

  Scenario: Prior phase done but no proof recorded yet leaves the gate open for the boundary proof to run
    Given no proof-of-work outcome has been recorded for phase "p1"
    When the batch status is computed
    Then phase "p2" is not blocked on a failing proof
    And "ratchet batch apply" selects phase "p1"'s boundary proof-of-work as the next step

  Scenario: A recorded failing proof blocks entry into the next phase
    Given a proof-of-work outcome has been recorded for phase "p1" with gatePassed false
    When the batch status is computed
    Then phase "p2" is reported as blocked
    And the gate reason cites phase "p1"'s failing proof-of-work
    And "ratchet batch apply" does not select phase "p2"'s outstanding change
    And "ratchet batch apply" reports the blocking proof rather than a generic "everything is gated" message

  Scenario: The block persists across separate stateless apply invocations
    Given a proof-of-work outcome has been recorded for phase "p1" with gatePassed false
    When a separate, later "ratchet batch apply" invocation runs
    Then phase "p2" is still blocked on phase "p1"'s failing proof
    And no change in phase "p2" is advanced

  Scenario: A recorded passing proof unblocks the next phase
    Given a proof-of-work outcome has been recorded for phase "p1" with gatePassed true
    When the batch status is computed
    Then phase "p2" is not blocked on a failing proof
    And "ratchet batch apply" selects phase "p2"'s outstanding change

  Scenario: A later passing proof reopens a gate an earlier failing proof had closed
    Given a proof-of-work outcome was recorded for phase "p1" with gatePassed false
    And a later proof-of-work outcome was recorded for phase "p1" with gatePassed true
    When the batch status is computed
    Then phase "p2" is not blocked on a failing proof
    And "ratchet batch apply" selects phase "p2"'s outstanding change
