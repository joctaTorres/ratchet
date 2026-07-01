Feature: batch apply verb behavior is proven by tests
  As a maintainer holding ratchet to the testing standard
  I want `batchApplyCommand`'s step selection, halt-respecting, and
    outcome-persisting contract under test
  So that single-step apply never advances a parked step and never spawns a
    real agent in the suite

  Background:
    Given an isolated tmpdir fixture repo built under os.tmpdir()
    And `resolveCurrentPlanningHomeSync` is pointed at the fixture root
    And the bundled `RatchetBatchEngine.runStep` is replaced by an injected fake
    So that no real agent is ever spawned during the test

  Scenario: nothing ready when every change is done
    Given a batch whose only change is already done
    When batchApplyCommand runs
    Then it reports "Nothing to do — all changes are done."
    And the injected engine is never invoked

  Scenario: a parked blocked step does not advance without an answer
    Given a batch with a change parked as blocked with no recorded answer
    When batchApplyCommand runs
    Then it reports the step did not advance and hints to record an answer
    And the injected engine is never invoked

  Scenario: a parked awaiting-approval step does not advance without a decision
    Given a batch with a change parked awaiting approval with no decision
    When batchApplyCommand runs
    Then it reports the step did not advance and hints to approve or reject
    And the injected engine is never invoked

  Scenario: a ready step advances through exactly one engine transition
    Given a batch with one ready change
    And an injected engine that returns an advanced result
    When batchApplyCommand runs
    Then the engine runs exactly one step for that change
    And the parked state for the change is cleared
    And the rendered result reports the change as advanced

  Scenario: an engine blocked result parks the step
    Given a batch with one ready change
    And an injected engine that returns a blocked result with a reason
    When batchApplyCommand runs
    Then the change is parked as blocked with that reason
    And the rendered result reports the change as blocked

  Scenario: --json emits the structured step result
    Given a batch with one ready change
    And an injected engine that returns an advanced result
    When batchApplyCommand runs with --json
    Then a single JSON object describing the step result is printed
