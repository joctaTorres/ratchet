Feature: Requesting the docker locus without Docker yields an actionable error
  As an operator who set locus=docker without a running Docker daemon
  I want a clear, immediate, actionable error
  So that I am told to install or start Docker instead of waiting on a hang

  Scenario: No Docker daemon produces a clear, fail-closed error
    Given the batch settings resolve locus to "docker"
    And no Docker daemon is available or running
    When the batch step attempts to run
    Then the run fails fast with an actionable error
    And the error message names locus=docker and tells the operator to install or start Docker
    And the run never hangs waiting on a missing daemon

  Scenario: The no-Docker error is surfaced like a bootstrap failure
    Given the docker locus is requested without a Docker daemon
    When the runtime resolves the launch
    Then the failure surfaces as a non-zero exit with the actionable message in stderr
    And the engine maps it to a blocked/failed outcome that stays resumable
    And no raw traceback is shown to the operator
