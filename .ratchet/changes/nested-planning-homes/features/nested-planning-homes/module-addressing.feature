Feature: Addressing a module from the root
  As a developer working at the monorepo root
  I want to target a specific module's planning home with a --module flag
  So that I can manage module changes without changing directory

  Background:
    Given a repository with a .ratchet directory at the repo root
    And a nested .ratchet directory at "packages/api" named "api"

  Scenario: Creating a change inside a module from the root
    Given the current working directory is the repo root
    When I run "ratchet new change add-auth --module api"
    Then the change is created at "packages/api/.ratchet/changes/add-auth"
    And the change uses the module's default schema

  Scenario: Reading status of a module change from the root
    Given a change "add-auth" exists in module "api"
    When I run "ratchet status --change add-auth --module api" from the repo root
    Then the reported planning home root is "packages/api"
    And the reported change root is "packages/api/.ratchet/changes/add-auth"

  Scenario: An unknown module name fails with the list of known modules
    When I run "ratchet status --change add-auth --module billing" from the repo root
    Then the command fails with an error naming "billing" as unknown
    And the error lists the discovered module names

  Scenario: Omitting --module keeps current nearest-wins behavior
    Given a change "root-change" exists in the root planning home
    When I run "ratchet status --change root-change" from the repo root
    Then the resolved planning home root is the repo root
