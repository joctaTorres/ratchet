Feature: Configurable container image and repo access for the docker locus
  As an operator
  I want to choose the container image and have my repo available inside it
  So that the agent can do real work and the engine can read the journal back

  Scenario: The configured image is used instead of a hard-coded default
    Given the batch image setting is set to a specific image reference
    And the batch settings resolve locus to "docker"
    When the sidecar deployment is constructed for the step
    Then the DockerDeployment is configured to use that image reference
    And the hard-coded "python:3.12" default is not used when an image is configured

  Scenario: A default image is used when none is configured
    Given the batch settings resolve locus to "docker"
    And no image setting is provided
    When the sidecar deployment is constructed for the step
    Then a documented default image is used
    And the default is recorded as coming from the defaults source

  Scenario: The project repo is mounted into the container at the workdir
    Given the batch settings resolve locus to "docker"
    And the project root contains the batch journal directory
    When the sidecar deployment is constructed for the step
    Then the project root is bind-mounted into the container read-write at the workdir
    And REX_WORKDIR maps to the in-container mount path
    So that journal writes inside the container propagate back to the host

  Scenario: An invalid image value is rejected before any container starts
    Given a request to set the batch image setting to an empty value
    When the setting is validated
    Then the setting is rejected with an actionable error
    And the project config file is left unchanged
