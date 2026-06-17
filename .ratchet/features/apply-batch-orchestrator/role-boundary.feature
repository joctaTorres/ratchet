Feature: Orchestrator role boundary
  As a ratchet maintainer
  I want the orchestrator to act only as a driver and interface
  So that all coding work happens inside the engine, never in the orchestrating session

  Background:
    Given a session running /rct:apply-batch for batch "q3-auth"

  Scenario: The orchestrator never writes or edits code directly
    Given a session running /rct:apply-batch for batch "q3-auth"
    When the orchestrator drives the batch
    Then it never writes or edits source code
    And it never hand-edits .ratchet artifacts
    And the actual coding work happens inside "ratchet batch apply", which spawns the coding agent via the engine

  Scenario: The orchestrator's only actions are ratchet CLI commands and user communication
    Given a session running /rct:apply-batch for batch "q3-auth"
    When the orchestrator takes any action
    Then that action is either a "ratchet" CLI command (status, apply, report, list, view, config) or a message to the user
    And it performs no other kind of action

  Scenario: The orchestrator translates CLI JSON state into human-readable updates
    Given "ratchet batch status q3-auth --json" returns machine-readable state
    When the orchestrator reports progress
    Then it translates the JSON phases, change statuses, after edges, and next step into a human-readable update
    And it acts as the interface between the ratchet CLI APIs and the user
