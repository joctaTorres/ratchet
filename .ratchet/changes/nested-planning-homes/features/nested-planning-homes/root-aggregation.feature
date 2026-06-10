Feature: Root aggregation of module changes
  As a developer at the monorepo root
  I want root-level listing to include changes from nested modules
  So that I can see all in-flight work across the repo in one place

  Background:
    Given a repository with a .ratchet directory at the repo root
    And a nested .ratchet directory at "packages/api" named "api"
    And a nested .ratchet directory at "packages/web" named "web"

  Scenario: Root list shows root and module changes labeled by module
    Given the root planning home contains a change "upgrade-ci"
    And module "api" contains a change "add-auth"
    And module "web" contains a change "dark-mode"
    When I run "ratchet list" from the repo root
    Then the output includes "upgrade-ci" attributed to the root
    And the output includes "add-auth" attributed to module "api"
    And the output includes "dark-mode" attributed to module "web"

  Scenario: Module-level list stays scoped to the module
    Given module "api" contains a change "add-auth"
    And the root planning home contains a change "upgrade-ci"
    When I run "ratchet list" from inside "packages/api"
    Then the output includes "add-auth"
    And the output does not include "upgrade-ci"

  Scenario: A module's broken config does not break root aggregation
    Given module "api" has an unparseable .ratchet/config.yaml
    And module "web" contains a change "dark-mode"
    When I run "ratchet list" from the repo root
    Then the output includes "dark-mode" attributed to module "web"
    And a warning reports that module "api" could not be loaded
