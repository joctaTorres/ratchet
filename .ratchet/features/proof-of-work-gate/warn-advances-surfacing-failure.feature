Feature: Warn policy advances while surfacing a failing proof-of-work
  As the ratchet batch host loop
  I want a failing proof under the warn policy to be visible but non-blocking
  So that warn surfaces problems without halting the batch

  Background:
    Given a batch with phase "p1" followed by phase "p2"
    And the batch's resolved proof-of-work policy is "warn"
    And every change in phase "p1" is done
    And phase "p2" has an outstanding change

  Scenario: A failing proof under warn does not block the next phase
    Given a proof-of-work outcome has been recorded for phase "p1" reporting passed false with gatePassed true
    When the batch status is computed
    Then phase "p2" is not reported as blocked
    And "ratchet batch apply" selects phase "p2"'s outstanding change

  Scenario: The warn failure is surfaced when the boundary proof runs
    Given no proof-of-work outcome has been recorded for phase "p1"
    And phase "p1"'s proof-of-work command fails
    When "ratchet batch apply" runs phase "p1"'s boundary proof-of-work
    Then the failing proof is surfaced in the rendered outcome
    But it does not block entry into phase "p2"
