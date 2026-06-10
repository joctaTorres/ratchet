Feature: Module-local feature stores
  As a maintainer of a monorepo
  I want archived features to land in the module's own feature store
  So that each module stays self-contained and its behavior record travels with its code

  Background:
    Given a repository with a .ratchet directory at the repo root
    And a nested .ratchet directory at "packages/api" named "api"

  Scenario: Archiving a module change materializes features into the module store
    Given module "api" contains a completed change "add-auth" with feature "features/auth/login.feature"
    When the change "add-auth" is archived
    Then "packages/api/.ratchet/features/auth/login.feature" exists
    And the root feature store does not contain "auth/login.feature"
    And the change is moved to "packages/api/.ratchet/changes/archive"

  Scenario: Archiving a root change materializes features into the root store
    Given the root planning home contains a completed change "upgrade-ci" with feature "features/ci/pipeline.feature"
    When the change "upgrade-ci" is archived
    Then ".ratchet/features/ci/pipeline.feature" exists at the repo root
    And no module feature store is modified

  Scenario: Standard links for an inherited standard are written into the defining home
    Given the root standards library contains a standard tagged "testing"
    And module "api" archives a change declaring standards ["testing"] with feature "features/auth/login.feature"
    When standard links are materialized
    Then the forward link sidecar is written in the module's feature store
    And the "Implemented by" block of the root standard "testing" lists the feature qualified by module name "api"

  Scenario: Standard links for a module-local standard stay within the module
    Given module "api" standards library contains a standard tagged "api-versioning"
    And module "api" archives a change declaring standards ["api-versioning"]
    When standard links are materialized
    Then the "Implemented by" block is regenerated in "packages/api/.ratchet/standards"
    And no file under the root .ratchet directory is modified
