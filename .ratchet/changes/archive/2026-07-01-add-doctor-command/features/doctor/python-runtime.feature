Feature: Python and uv runtime preflight
  As a developer who will run batch changes through the SWE-ReX sidecar
  I want doctor to verify a usable Python or uv toolchain
  So that the swe-rex runtime can be bootstrapped without a late failure

  Background:
    Given a project with ratchet initialized

  Scenario: uv is preferred when available
    Given uv is installed on PATH
    When I run "ratchet doctor"
    Then the runtime check is marked as passing
    And uv is reported as the preferred runtime provider

  Scenario: Python 3.10+ with venv and pip satisfies the runtime requirement
    Given uv is not installed on PATH
    And a Python 3.10+ interpreter with venv and pip is available
    When I run "ratchet doctor"
    Then the runtime check is marked as passing
    And the detected Python interpreter and version are reported

  Scenario: An older Python is rejected with the required minimum
    Given uv is not installed on PATH
    And the only Python interpreter on PATH is older than 3.10
    When I run "ratchet doctor"
    Then the runtime check is marked as failing
    And the message states the minimum required Python version
    And the command exits with a non-zero status

  Scenario: Neither uv nor a usable Python is present
    Given uv is not installed on PATH
    And no Python interpreter is found on PATH
    When I run "ratchet doctor"
    Then the runtime check is marked as failing
    And the output includes a remedy to install Python or uv
    And the command exits with a non-zero status
