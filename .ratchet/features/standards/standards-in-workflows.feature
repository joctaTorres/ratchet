Feature: Standards drive propose and verify
  As a developer driving a change through ratchet
  I want my standards loaded automatically during propose and verify
  So that the plan bakes in the standards and the implementation is checked against them

  Background:
    Given a project that uses ratchet
    And a ".ratchet/standards/" directory containing "testing.md" and "security.md"

  Scenario: Propose surfaces the active standards to the agent
    Given a new change "add-search"
    When I request the propose instructions for the change
    Then the instructions include the content of "testing.md" and "security.md"
    And the instructions tell the agent to embed the applicable standards into the change

  Scenario: The proposed plan embeds the applicable standards
    Given the standards describe a testing standard and a security standard
    When I propose the change "add-search"
    Then the generated plan references the applicable standards
    And the plan's Design or Tasks reflect what those standards require

  Scenario: Verify loads the standards to check compliance
    Given a change "add-search" whose plan embedded the testing and security standards
    When I verify the change
    Then verify loads the active standards from the standards library
    And verify checks the implementation against the testing and security standards

  Scenario: Verify reports a standard that was not met
    Given a change "add-search" whose security standard requires input validation
    And the implementation performs no input validation
    When I verify the change
    Then verification reports the unmet security standard

  Scenario: Apply does not read the standards directory
    Given a change "add-search" whose plan already embedded the standards
    When I request the apply instructions for the change
    Then the instructions do not load the standards directory
    And applying the change follows only the feature files and the plan

  Scenario: A project with no standards proposes and verifies normally
    Given the ".ratchet/standards/" directory is empty
    When I propose and then verify the change "add-search"
    Then propose and verify behave exactly as they did before standards existed
    And no standards section is injected into the instructions
