Feature: Explore as a thinking stance
  As a developer with an unclear idea
  I want an explore stance that is a thinking partner
  So that I can reason about a problem without producing application code

  Scenario: Explore reasons and may create artifacts but never implements
    Given an unclear idea passed to the explore stance
    When the agent enters explore mode
    Then it may read the codebase, draw diagrams and create planning artifacts
    And it never writes application code

  Scenario: Explore is a stance, not a fixed workflow
    Given the explore agent surface
    When the agent operates in explore mode
    Then it follows the conversation rather than a fixed sequence of steps
    And it asks clarifying questions that emerge from what the user said
