Feature: Propose seeds feature files from the feature store
  As a developer authoring a change through the propose workflow
  I want each feature file started from the capability's existing store file
  So that accepted scenarios already in the store are preserved by construction
  and a later archive never silently drops them

  Background:
    Given the propose skill and command bodies shared by every registered agent

  Scenario: The propose body directs reading the capability's store files before authoring
    Given a change whose features artifact targets a capability
    When the propose body authors a feature file for that capability
    Then the body directs the agent to read the capability's existing store files under ".ratchet/features/<capability>/" before authoring

  Scenario: The propose body forbids duplicating a scenario from another store file of the capability
    Given a scenario already exists in another store file of the capability
    When the propose body authors a feature file for that capability
    Then the body forbids adding a scenario that already exists in another store file of the capability

  Scenario: Each feature file starts from the existing store file
    Given a store file already exists at the feature file's store-relative path
    When the propose body authors that feature file
    Then the body directs the agent to start the file from the existing store file by copying it into the change and editing the copy
    And the body forbids authoring the file from scratch
    And the stated purpose is that existing store scenarios are preserved by construction

  Scenario: A feature file with no store counterpart is authored new
    Given no store file exists at the feature file's store-relative path
    When the propose body authors that feature file
    Then the body permits authoring the file new

  Scenario: Every registered agent's rendered propose output carries the store-seeding instruction
    Given the supported-tools registry
    When the propose skill template and command template are rendered for each registered agent
    Then every rendered body directs reading the capability's store files before authoring
    And every rendered body forbids adding a scenario that already exists in another store file of the capability
    And every rendered body directs starting each feature file from the existing store file by copying and editing it
    And every rendered body forbids authoring from scratch when a store file exists
    And the checked agent set is non-empty and covers every registered agent

  Scenario: The features artifact instruction carries the store-seeding line
    Given the ratchet schema's features artifact instruction
    When the instructions payload is generated for a features artifact
    Then the payload directs starting from the store file when ".ratchet/features/<cap>/<file>.feature" already exists at the target path
    And the payload forbids recreating that file from scratch
    And the one-file-per-scenario-set guidance is kept

  Scenario: The store-seeding assertions reject a pre-change propose body
    Given a sample propose body in the pre-change shape — feature files authored from the template with no store read
    When the store-seeding rendered-output assertions run against it
    Then the assertions fail
