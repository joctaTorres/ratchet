Feature: Coding-agent CLI preflight
  As a developer driving ratchet with a coding agent
  I want doctor to verify a coding-agent CLI is actually installed
  So that batch runs do not fail with a raw ENOENT for a missing binary

  Background:
    Given a project with ratchet initialized

  Scenario: At least one supported agent CLI must be installed
    Given none of the supported coding-agent CLIs are installed on PATH
    When I run "ratchet doctor"
    Then the agent preflight check is marked as failing
    And the failure message states that at least one coding-agent CLI is required
    And the message lists the supported coding-agent CLIs
    And the command exits with a non-zero status

  Scenario: A single installed agent CLI satisfies the requirement
    Given exactly one supported coding-agent CLI is installed on PATH
    And no other supported coding-agent CLI is installed
    When I run "ratchet doctor"
    Then the agent preflight check is marked as passing
    And the installed coding-agent CLI is listed as detected

  Scenario: Checks every supported coding agent, not only the default
    Given the only installed coding-agent CLI is one other than the default agent
    When I run "ratchet doctor"
    Then the agent preflight check is marked as passing
    And the installed non-default coding-agent CLI is listed as detected

  Scenario: Reports the resolved version of an installed agent CLI
    Given a supported coding-agent CLI is installed on PATH and reports its version
    When I run "ratchet doctor"
    Then the detected coding-agent CLI is listed with its reported version

  Scenario: An agent CLI that errors on a version probe is still reported as present
    Given a supported coding-agent CLI is on PATH but its version probe fails
    When I run "ratchet doctor"
    Then the agent preflight check is marked as passing
    And the coding-agent CLI is listed as detected with an unknown version
