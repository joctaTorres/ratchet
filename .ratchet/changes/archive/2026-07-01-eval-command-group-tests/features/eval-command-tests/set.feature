Feature: Eval set verb
  As a user enumerating the eval case set
  I want `ratchet eval set` to list cases over an isolated fixture repo
  So that I can see every case and its binding status without a real repo

  Background:
    Given an isolated tmpdir fixture repo with resolveCurrentPlanningHomeSync
      pointed at the fixture root
    And the feature store contains a .feature file with at least one Scenario
    And console.log is spied so emitted output can be asserted

  Scenario: Listing the store cases as JSON
    Given a check-bound case and an unbound case in the store
    When evalSetCommand runs with --json
    Then the JSON payload reports the scope, the case count, and each case's
      id, feature, scenario, source, steps, and binding

  Scenario: Listing the store cases as text
    Given a check-bound case and an unbound case in the store
    When evalSetCommand runs without --json
    Then the text output tags the bound case with its binding kind
    And tags the unbound case as "[unbound]"
    And prints the feature and scenario for each case

  Scenario: Combining scope flags is rejected before enumeration
    Given both --changes and --change are set
    When evalSetCommand runs
    Then it throws the mutually-exclusive scope error
    And nothing is enumerated
