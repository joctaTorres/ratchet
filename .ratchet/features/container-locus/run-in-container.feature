Feature: Run a batch step inside a container via the docker locus
  As an operator running a batch
  I want a step's coding agent to execute inside a container when locus=docker
  So that the work is isolated from the host while behaving identically to local

  Background:
    Given a project whose batch settings resolve locus to "docker"
    And a Docker daemon is available on the machine
    And a container image that carries an in-container marker not present on the host

  Scenario: The step executes inside the container (in-container marker observed)
    Given a stub agent command that prints the value of the in-container marker
    When the batch step runs through the AgentRuntime
    Then the streamed output contains the in-container marker value
    And the marker value differs from the equivalent value on the host
    So that the step is proven to have executed inside the container, not on the host

  Scenario: The calling code path is unchanged for docker
    Given the same AgentRuntime, engine, and renderer used for the local locus
    When the step runs with locus=docker
    Then no engine, renderer, or runtime calling code branches on the locus beyond runtime selection
    And the only difference from local is the sidecar's deployment construction and provisioning
