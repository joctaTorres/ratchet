Feature: Gherkin feature authoring
  As an author describing desired behavior
  I want features written as executable Gherkin grouped by capability
  So that each scenario is a verifiable contract the implementation must satisfy

  Background:
    Given the ratchet "features" artifact whose glob is "features/**/*.feature"

  Scenario: Behavior is grouped by capability in kebab-case paths
    Given a new behavior for user login
    When I author its feature file
    Then it lives at "features/<capability>/<name>.feature"
    And both the capability and file name use kebab-case

  Scenario: A feature file must declare a Feature line
    Given a ".feature" file with scenarios but no "Feature:" line
    When the file is parsed and validated
    Then validation reports an error that the file must start with a "Feature:" line

  Scenario: A feature file must contain at least one scenario
    Given a ".feature" file that has only a "Feature:" line
    When the file is validated
    Then validation reports an error that the feature must have at least one scenario

  Scenario: Every scenario must include Given, When and Then
    Given a scenario that has a When and a Then but no Given
    When the scenario is validated
    Then validation reports an error that the scenario must include at least one Given, When and Then step
    But And/But continuation steps do not satisfy a missing primary keyword

  Scenario: Background steps do not satisfy a scenario's required steps
    Given a feature whose Background supplies a shared Given
    And a scenario in that feature with only When and Then steps
    When the scenario is validated
    Then the Background Given is not counted toward the scenario
    And the scenario is reported as missing its Given
