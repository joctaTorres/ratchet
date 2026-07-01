Feature: Read the latest recorded proof-of-work outcome per phase
  As the ratchet batch host loop
  I want a reader that returns the latest recorded proof-of-work outcome for a phase
  So that the verdict survives across the stateless single-step apply invocations

  Scenario: The reader returns the recorded outcome for a phase
    Given a proof-of-work outcome has been recorded for phase "p1"
    When the recorded-proof reader is queried for phase "p1"
    Then it returns the ProofOfWorkResult recorded for phase "p1"
    And the result carries the phase, passed, gatePassed, policy, reason, and detail fields

  Scenario: The latest recording wins when a phase has more than one
    Given a proof-of-work outcome was recorded for phase "p1" reporting passed false
    And a later proof-of-work outcome was recorded for phase "p1" reporting passed true
    When the recorded-proof reader is queried for phase "p1"
    Then it returns the later outcome reporting passed true

  Scenario: The verdict survives across separate stateless apply invocations
    Given one "ratchet batch apply" invocation recorded a proof-of-work outcome for phase "p1"
    When a separate, later "ratchet batch apply" invocation reads the recorded proof for phase "p1"
    Then the recorded verdict is still available from the durable journal

  Scenario: No recorded outcome yet for a phase
    Given no proof-of-work outcome has been recorded for phase "p1"
    When the recorded-proof reader is queried for phase "p1"
    Then it returns no recorded outcome
