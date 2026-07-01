Feature: Surface the change's success criterion to the coding agent
  As a coding agent driving one batch transition
  I want the step instructions to state the success criterion of the change I am working on
  So that I implement to that change's own bar, alongside the broader phase goal

  Scenario: Instructions include the change's success criterion when present
    Given a batch step for a change whose intent declares a success criterion
    When the engine builds the agent instructions for that transition
    Then the instructions include the change's success criterion as its own line
    And the instructions still include the phase goal and phase success criteria

  Scenario: Instructions omit the change-success line when absent
    Given a batch step for a change whose intent declares no success criterion
    When the engine builds the agent instructions for that transition
    Then the instructions contain no change-success line
    And the instructions still include the phase goal and phase success criteria

  Scenario: The change-success line is agent-neutral
    Given a batch step for a change with a success criterion
    When the engine builds the agent instructions for that transition
    Then the change-success line refers to the work generically and names no specific coding agent
