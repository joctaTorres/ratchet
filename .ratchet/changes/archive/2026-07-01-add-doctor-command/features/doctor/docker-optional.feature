Feature: Docker daemon is optional
  As a developer who may or may not use the docker execution locus
  I want doctor to treat Docker as optional
  So that a missing Docker daemon never fails doctor when I run locally

  Background:
    Given a project with ratchet initialized
    And the runtime and agent preflight requirements are satisfied

  Scenario: A missing Docker daemon is informational, not a failure
    Given the Docker daemon is not available
    When I run "ratchet doctor"
    Then Docker is reported as an optional dependency
    And the Docker notice explains it is only needed for the docker execution locus
    And the command exits with status 0

  Scenario: An available Docker daemon is reported as present
    Given the Docker daemon is available
    When I run "ratchet doctor"
    Then Docker is reported as available
    And the command exits with status 0
