Feature: Surface the change's `done` criterion to the coding agent
  As a coding agent driving one batch transition
  I want the step instructions to state the `done` criterion of the change I am working on
  So that I implement to that change's own bar, alongside the broader phase goal

  Scenario: Instructions always include the change's `done` criterion
    Given a batch step for a change whose intent declares a `done` criterion
    When the engine builds the agent instructions for that transition
    Then the instructions include the change's `done` criterion on its own line
    And the instructions still include the phase goal and phase success criteria

  Scenario: The change `done` line is agent-neutral
    Given a batch step for a change with a `done` criterion
    When the engine builds the agent instructions for that transition
    Then the change `done` line refers to the work generically and names no specific coding agent

  Scenario: No "Change success criteria" line is emitted
    Given a batch step for a change
    When the engine builds the agent instructions for that transition
    Then the instructions contain no "Change success criteria" line
