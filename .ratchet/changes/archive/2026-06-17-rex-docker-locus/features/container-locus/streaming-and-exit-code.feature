Feature: Live streaming and captured exit code in the docker locus
  As an operator watching a containerized step
  I want the agent's output to stream live and the exit code to be captured
  So that the docker locus has the same real-time UX and outcome mapping as local

  Background:
    Given a Docker daemon is available on the machine
    And the batch settings resolve locus to "docker"

  Scenario: Output streams incrementally from inside the container
    Given a stub agent that emits one line per second for several lines inside the container
    When the step runs through the AgentRuntime with the docker locus
    Then the streamed lines arrive incrementally, spread across the run
    And they are not delivered as a single batched dump at the end

  Scenario: A non-zero exit code is captured from the container
    Given a stub agent inside the container that exits with a non-zero status
    When the step runs through the AgentRuntime with the docker locus
    Then the AgentSpawnResult records that same non-zero exit code
    And the accumulated transcript contains the streamed lines

  Scenario: stream-json rendering is identical in-container
    Given a stream-json-capable adapter drives the step
    When the step runs with locus=docker
    Then the same renderer parses the NDJSON event stream
    And assistant text, tool calls, tool results, and the final summary render identically to local
