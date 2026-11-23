Feature: Explore workflow template retired
  As a ratchet maintainer
  I want the dead explore workflow template retired
  So that no generated skill, command, or document claims an explore workflow
  that nothing ships

  Scenario: The generated agent surface contains no explore skill or command
    Given ratchet generates skills and commands for every registered agent
    When the agent surface is generated for a project
    Then no ratchet-explore skill directory is generated for any agent
    And no explore command file is generated for any agent

  Scenario: Project documentation attributes no explore stance to propose
    Given the README agent-workflows section
    When it is read
    Then it does not claim that propose reuses an explore stance
    And it describes no standalone or internal explore workflow surface

  Scenario: The retired explore stance spec leaves the feature store on archive
    Given the change is archived
    When its feature delta is applied to the feature store
    Then the agent-workflows explore-stance feature file is removed from the store
