Feature: An agent CLI rejecting an argument is reported as an argv rejection, not a model problem
  As a ratchet batch operator
  I want a parked reason that names the CLI option the agent rejected
  So that I fix the real incompatibility instead of chasing an invalid model id

  Background:
    Given a batch stage configured with an explicit agent model
    And the agent wrote no journal entries during the session
    And the agent exited with a non-zero exit code and no signal

  Scenario: stderr reports an unexpected argument
    Given the agent's stderr contains "error: unexpected argument '--ask-for-approval' found"
    When the engine maps the step outcome
    Then the outcome is "failed"
    And the blocker names the rejected option "--ask-for-approval"
    And the blocker names the agent that rejected it
    And the blocker does NOT contain the model-id hint "If this model id is invalid"
    And the outcome detail still includes the stderr tail

  Scenario: stderr has no argument rejection
    Given the agent's stderr does not contain an "unexpected argument" error
    When the engine maps the step outcome
    Then the blocker carries the model-attribution hint exactly as before

  Scenario: an argument rejection without an explicit model still names the option
    Given the stage's agent setting names no model
    And the agent's stderr contains "error: unexpected argument '--full-auto' found"
    When the engine maps the step outcome
    Then the blocker names the rejected option "--full-auto"
