Feature: Updating the generated agent surface
  As a developer keeping ratchet current
  I want update to regenerate the /rct: skills and commands
  So that my AI tools always have the latest workflow instructions

  Background:
    Given a project already initialized with ratchet

  Scenario: Update regenerates skills and commands for configured tools
    Given configured tools whose generated /rct: files are stale
    When I run "ratchet update"
    Then the skills and command files are regenerated for those tools
    And the regenerated files reflect the current ratchet version

  Scenario: Force rewrites files even when tools are up to date
    Given configured tools whose generated files are already current
    When I run "ratchet update --force"
    Then the skill and command files are rewritten anyway
    And the update does not skip them as up to date

  Scenario: Update targets a specific project path
    Given a project at a non-default path
    When I run "ratchet update <path>"
    Then the agent surface under that path is refreshed
    And other directories are left untouched
