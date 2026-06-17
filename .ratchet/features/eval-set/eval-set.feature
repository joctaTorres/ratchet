Feature: Enumerate eval cases from feature files
  As a coding agent driving an eval run
  I want the CLI to turn local .feature files into a machine-readable eval set
  So that every Gherkin scenario becomes a gradable eval case

  Scenario: Default scope is the permanent feature store
    Given a project with feature files under ".ratchet/features" and an archived change under ".ratchet/changes/archive"
    When I run "ratchet eval set --json"
    Then the eval set contains one case per Scenario found under ".ratchet/features/**/*.feature"
    And no case sources from ".ratchet/changes/archive"

  Scenario: A case carries its behavior contract
    Given a feature file with a Scenario holding Given/When/Then steps
    When the eval set is produced
    Then the case includes the feature name, scenario name, source file path and the ordered steps

  Scenario: Case identifiers are stable across runs
    Given an unchanged feature store
    When the eval set is produced twice
    Then each case has the same identifier in both sets
    And the identifier is derived from the feature file path and scenario name

  Scenario: Active changes are included on request
    Given an active change "add-login" with feature files under its "features" directory
    When I run "ratchet eval set --changes --json"
    Then cases from ".ratchet/changes/add-login/features" are included alongside the feature store
    And archived changes remain excluded

  Scenario: A single change can be targeted by name
    Given active changes "add-login" and "add-export"
    When I run "ratchet eval set --change add-login --json"
    Then only cases from "add-login" feature files are listed

  Scenario: The set can be narrowed to a capability directory or file
    Given a feature store with capabilities "validation" and "standards"
    When I run "ratchet eval set --path validation --json"
    Then only cases whose source file lives under "features/validation" are listed
