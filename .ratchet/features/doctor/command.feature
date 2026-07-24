Feature: ratchet doctor command
  As a developer setting up ratchet
  I want a command that validates external (non-npm) runtime dependencies
  So that I learn what is missing before a batch run fails deep inside the engine

  Background:
    Given a project with ratchet initialized

  Scenario: Reports an all-clear when every required dependency is present
    Given at least one supported coding-agent CLI is installed on PATH
    And a Python 3.10+ interpreter with venv and pip is available
    When I run "ratchet doctor"
    Then it prints a check for each dependency it inspected
    And every required check is marked as passing
    And the command exits with status 0

  Scenario: Fails when a required dependency is missing
    Given no supported coding-agent CLI is installed on PATH
    When I run "ratchet doctor"
    Then the missing required dependency is marked as failing
    And the output includes a remedy describing how to install it
    And the command exits with a non-zero status

  Scenario: Surfaces optional dependencies without failing
    Given at least one supported coding-agent CLI is installed on PATH
    And a Python 3.10+ interpreter with venv and pip is available
    And neither uv nor the Docker daemon is available
    When I run "ratchet doctor"
    Then the optional dependencies are reported as informational notices
    And the command exits with status 0

  Scenario: Machine-readable output for scripting
    Given at least one supported coding-agent CLI is installed on PATH
    When I run "ratchet doctor --json"
    Then the output is a single JSON object listing every check with its status and severity
    And no spinner or decorative text is written to stdout
