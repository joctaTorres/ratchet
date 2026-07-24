Feature: proof-of-work evaluation remainder is proven by unit tests
  As a maintainer holding ratchet to the testing standard
  I want the remaining branches of src/core/batch/engine/proof-of-work.ts under
    unit test
  So that pass-condition evaluation and gating policy can only ratchet upward

  Background:
    Given the bash runner and llm-judge are injected as deterministic fakes
    And the unit tests spawn no real process and reach no network

  Scenario: a default substring condition passes only on exit zero with the needle in stdout
    Given a pass condition that is plain text with no recognized prefix
    When evaluatePassCondition runs against a result whose stdout contains the text and exit code is 0
    Then it reports passed with reason "pass-condition-met"

  Scenario: a satisfied substring condition still fails on a nonzero exit
    Given a plain-text pass condition matched in stdout
    When evaluatePassCondition runs against a result whose exit code is nonzero
    Then it reports not-passed with reason "nonzero-exit"

  Scenario: a contains condition unmet while exit zero is pass-condition-unmet
    Given a "contains:" pass condition whose needle is absent from stdout
    When evaluatePassCondition runs against an exit-zero result
    Then it reports not-passed with reason "pass-condition-unmet"

  Scenario: an invalid regex condition never throws and fails the match
    Given a "regex:" pass condition holding an unparseable pattern
    When evaluatePassCondition runs against an exit-zero result
    Then it reports not-passed without throwing

  Scenario: an llm-judge kind with no adapter fails closed
    Given an llm-judge proof-of-work and no judge adapter wired in
    When runProofOfWork runs under the hard-gate policy
    Then the result is not passed with reason "error" and the gate does not pass

  Scenario: a thrown judge is reported as an error
    Given an llm-judge adapter that rejects
    When runProofOfWork runs
    Then the result is not passed with reason "error" carrying the thrown message

  Scenario: a passing judge yields judge-pass
    Given an llm-judge adapter that returns a passing verdict
    When runProofOfWork runs
    Then the result is passed with reason "judge-pass" carrying the verdict reason

  Scenario: a thrown bash command is reported as an error
    Given an integration proof-of-work whose bash runner rejects
    When runProofOfWork runs
    Then the result is not passed with reason "error"

  Scenario: the warn policy lets a failed proof-of-work pass the gate
    Given a failing integration proof-of-work under the "warn" policy
    When runProofOfWork runs
    Then the proof is not passed but the gate is allowed to pass
