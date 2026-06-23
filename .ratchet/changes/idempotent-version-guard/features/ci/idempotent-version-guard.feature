Feature: An idempotent version guard skips publishing an already-published version without erroring
  As a maintainer of the ratchet package
  I want the publish job to consult a version guard before publishing
  So that re-running the pipeline on a version that is already on the registry is a clean no-op (SKIP) rather than a hard error — the release is idempotent

  Background:
    Given the publish job is reachable only when the release decision is ALLOW on "main"
    And the package declares a local version in package.json

  Scenario: A new version is decided PUBLISH
    Given the local version is not present in the set of already-published versions
    When the version guard decides
    Then the outcome is PUBLISH
    And the reason set is empty

  Scenario: An already-published version is decided SKIP
    Given the local version is already present in the set of already-published versions
    When the version guard decides
    Then the outcome is SKIP
    And the reason explains the version is already published

  Scenario: The guard runner emits should_publish=true for a new version
    Given the local version is not among the already-published versions
    When the version-guard runner runs
    Then it writes "should_publish=true" to the GitHub step output
    And it exits zero

  Scenario: The guard runner emits should_publish=false for an already-published version
    Given the local version is among the already-published versions
    When the version-guard runner runs
    Then it writes "should_publish=false" to the GitHub step output
    And it exits zero so the pipeline is not errored

  Scenario: The publish job runs the version guard before the publish step
    Given the CI workflow's "publish" job
    When its steps are inspected
    Then a version-guard step exposes a "should_publish" output
    And the publish step runs only when "should_publish" is "true"

  Scenario: The publish step stays a dry-run in this slice
    Given the CI workflow's "publish" job
    When its publish step is inspected
    Then it runs the publish path as "npm publish --dry-run"
    And it requires no npm token secret to run
