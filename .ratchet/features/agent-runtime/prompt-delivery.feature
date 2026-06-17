Feature: Step instructions reach the agent inside the ReX session
  As the batch engine
  I want the step instructions delivered to the agent that runs in the ReX session
  So that the agent gets its prompt even though the sidecar runs a shell command, not stdin

  Background:
    Given the sidecar runs a shell command string in the ReX session
    And it does not pipe stdin to the agent

  Scenario: Instructions are written to a temp prompt file under the batch run dir
    Given a step with instructions for the agent
    When the runtime prepares the run command
    Then the instructions are written to a prompt file under ".ratchet/batches/<batch>/.run/<id>/"
    And the run command feeds that prompt file to the agent

  Scenario: The agent command is plain raw invocation for this phase
    Given the claude adapter for this phase
    When the run command is constructed
    Then the agent is invoked with its plain argv, without "--output-format stream-json"
    And the prompt is supplied from the prompt file rather than from stdin

  Scenario: The temp prompt file is cleaned up
    Given a run that wrote a temp prompt file
    When the step completes or fails
    Then the temp prompt file is removed
