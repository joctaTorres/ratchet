Feature: The local locus remains the default and is unaffected
  As an operator who has not opted into docker
  I want the local locus to keep working exactly as before
  So that adding the docker locus introduces no regression or new requirement

  Scenario: local stays the default locus
    Given a project with no locus configured anywhere
    When the batch settings are resolved
    Then the effective locus is "local"
    And its source is the defaults source

  Scenario: The local path imports no docker-only dependencies
    Given the batch settings resolve locus to "local"
    When the sidecar runs the step
    Then the docker deployment module is never imported
    And no docker daemon, image, or mount is required

  Scenario: A configured image does not affect the local locus
    Given an image setting is configured
    And the batch settings resolve locus to "local"
    When the step runs through the AgentRuntime
    Then the image setting is ignored
    And the step behaves exactly as it did before this change
