Feature: Bind eval cases to a fixture and a check
  As an eval author
  I want each scenario bound to a pre-determined codebase and a judging check
  So that verdicts are reproducible instead of read from the live working tree

  Scenario: An eval-spec maps a case to a fixture and a check
    Given an eval set enumerated from the feature files
    When I author an eval-spec under ".ratchet/evals/specs" binding a case id to a fixture and a check
    Then the binding names a fixture directory under ".ratchet/evals/fixtures"
    And it declares a check kind of "check" or "agent"

  Scenario: A check binding carries a deterministic pass condition
    Given a case bound with a "check" kind
    When the binding is loaded
    Then it provides a bash command to run against the fixture
    And a pass condition of "exit-zero", "contains:<text>" or "regex:<pattern>"

  Scenario: An agent binding carries the success criteria to judge against
    Given a case bound with an "agent" kind
    When the binding is loaded
    Then it provides the success criteria the spawned judge must satisfy
    And it names the fixture the judge runs against
    And it may declare how many repeat votes the judge casts

  Scenario: A fixture may declare a one-time setup command
    Given a binding whose fixture needs bootstrapping before it can be judged
    When the binding declares a "setup" command
    Then the setup runs once into a cached working copy keyed by fixture and setup
    And every case bound to that fixture reuses the cached copy instead of bootstrapping again

  Scenario: Unbound cases are unjudged, never passed
    Given an eval set with a case that has no binding in any eval-spec
    When the eval runs
    Then that case is recorded as "unjudged"
    And it is never counted as a pass

  Scenario: A fixture is a checked-in pre-determined codebase
    Given a binding that names fixture "status-ok"
    When the case is judged
    Then the judge runs against a working copy of ".ratchet/evals/fixtures/status-ok"
    And the live working tree is not used as the judging codebase
