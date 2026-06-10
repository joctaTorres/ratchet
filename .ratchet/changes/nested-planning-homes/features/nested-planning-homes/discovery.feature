Feature: Module discovery from the root planning home
  As a developer at the root of a monorepo
  I want ratchet to discover nested .ratchet directories on the filesystem
  So that new modules are visible without manual registration, while a registry can lint the expected layout

  Background:
    Given a repository with a .ratchet directory at the repo root

  Scenario: Nested planning homes are discovered by filesystem scan
    Given nested .ratchet directories exist at "packages/api" and "packages/web"
    And the root config declares no module registry
    When I run "ratchet list" from the repo root
    Then modules "packages/api" and "packages/web" are discovered
    And no registry warnings are shown

  Scenario: Module names default to the path relative to the repo root
    Given a nested .ratchet directory exists at "packages/api"
    When the module is discovered
    Then its module name is "packages/api"

  Scenario: A module can override its name in its own config
    Given a nested .ratchet directory exists at "packages/api"
    And "packages/api/.ratchet/config.yaml" declares name "api"
    When the module is discovered
    Then its module name is "api"

  Scenario: Discovered module missing from the registry produces a warning
    Given the root config registers modules ["packages/api"]
    And nested .ratchet directories exist at "packages/api" and "packages/web"
    When I run "ratchet list" from the repo root
    Then module "packages/web" is still included in the results
    And a warning reports that "packages/web" is not registered

  Scenario: Registered module missing on disk produces a warning
    Given the root config registers modules ["packages/api", "packages/legacy"]
    And a nested .ratchet directory exists only at "packages/api"
    When I run "ratchet list" from the repo root
    Then a warning reports that registered module "packages/legacy" has no .ratchet directory
    And the command still succeeds

  Scenario: Discovery does not descend into nested modules or ignored directories
    Given a nested .ratchet directory exists at "packages/api"
    And a directory "node_modules" containing a stray .ratchet directory
    When modules are discovered from the repo root
    Then "node_modules" is not reported as a module
    And no .ratchet directory nested below "packages/api" is reported as a separate module
