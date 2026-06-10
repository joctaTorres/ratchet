Feature: Standards inheritance across nested planning homes
  As a maintainer of a monorepo
  I want module changes to see root standards plus their own module standards
  So that org-wide rules propagate while modules can specialize

  Background:
    Given a repository with a .ratchet directory at the repo root
    And a nested .ratchet directory at "packages/api" named "api"

  Scenario: Module instructions include inherited root standards
    Given the root standards library contains a standard tagged "testing"
    And module "api" has no standards of its own
    When I run "ratchet instructions plan --change add-auth --module api"
    Then the standards in the output include "testing"

  Scenario: Module standards are added on top of root standards
    Given the root standards library contains a standard tagged "testing"
    And module "api" standards library contains a standard tagged "api-versioning"
    When instructions are generated for a change in module "api"
    Then the standards in the output include both "testing" and "api-versioning"

  Scenario: On tag collision the module standard shadows the root standard
    Given the root standards library contains a standard tagged "testing" with content "root version"
    And module "api" standards library contains a standard tagged "testing" with content "api version"
    When instructions are generated for a change in module "api"
    Then exactly one standard tagged "testing" is included
    And its content is "api version"

  Scenario: Root changes see only root standards
    Given the root standards library contains a standard tagged "testing"
    And module "api" standards library contains a standard tagged "api-versioning"
    When instructions are generated for a change in the root planning home
    Then the standards in the output include "testing"
    And the standards in the output do not include "api-versioning"

  Scenario: Standard tags declared by a module change validate against the layered set
    Given the root standards library contains a standard tagged "testing"
    And a change in module "api" declares standards ["testing"]
    When the change's standard tags are validated
    Then validation succeeds even though "testing" is not defined in the module
