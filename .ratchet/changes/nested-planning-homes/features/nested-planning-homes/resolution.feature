Feature: Nearest planning home wins
  As a developer in a monorepo
  I want ratchet to resolve the closest .ratchet directory to where I work
  So that commands run inside a sub-module operate on that module without extra flags

  Background:
    Given a repository with a .ratchet directory at the repo root
    And a nested .ratchet directory at "packages/api"

  Scenario: Command run inside a module resolves the module's planning home
    Given the current working directory is "packages/api/src"
    When I run "ratchet status"
    Then the resolved planning home root is "packages/api"
    And changes are read from "packages/api/.ratchet/changes"

  Scenario: Command run at the repo root resolves the root planning home
    Given the current working directory is the repo root
    When I run "ratchet status"
    Then the resolved planning home root is the repo root
    And changes are read from ".ratchet/changes"

  Scenario: Single-home repositories behave exactly as before
    Given a repository whose only .ratchet directory is at the repo root
    And the current working directory is any subdirectory of the repo
    When I run any ratchet command
    Then the resolved planning home root is the repo root
    And no module-related warnings or output are shown

  Scenario: list, view, and archive obey walk-up resolution
    Given the current working directory is "packages/api/src"
    When I run "ratchet list"
    Then the listed changes come from "packages/api/.ratchet/changes"
    And the command does not read ".ratchet" relative to the current working directory
