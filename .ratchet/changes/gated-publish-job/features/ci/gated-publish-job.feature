Feature: A dedicated publish job reachable only when the release decision is ALLOW
  As a maintainer of the ratchet package
  I want the publish to live in its own CI job, gated by the release-decision module's verdict
  So that the publish path is reachable ONLY on a green build of "main" and is skipped entirely for a non-main branch or any red gate — still dry-run, nothing published

  Background:
    Given the release-decision module decides ALLOW only when the branch is "main" and every wired gate is green
    And the release-gate runner adapts that verdict into a process exit code for the workflow

  Scenario: The release-gate runner emits a machine-readable ALLOW decision for the workflow graph
    Given the build is on the "main" branch with every wired gate green
    When the release-gate runner runs
    Then the decision is ALLOW
    And it writes "release_allowed=true" to the GitHub step output

  Scenario: The release-gate runner emits a machine-readable DENY decision
    Given the build is on the "main" branch with a red wired gate
    When the release-gate runner runs
    Then the decision is DENY
    And it writes "release_allowed=false" to the GitHub step output

  Scenario: The release-gate runner emits a machine-readable DENY decision off main
    Given the build is on a non-main branch with every wired gate green
    When the release-gate runner runs
    Then the decision is DENY
    And it writes "release_allowed=false" to the GitHub step output

  Scenario: The ci job exposes the release decision as a job output
    Given the CI workflow's "ci" job
    When the ci job's outputs are inspected
    Then it exposes a "release_allowed" output sourced from the release-gate step's output

  Scenario: A dedicated publish job is gated on the release decision
    Given the CI workflow
    When the jobs are inspected
    Then there is a separate "publish" job distinct from the "ci" job
    And the publish job needs the "ci" job
    And the publish job runs only when the ci job's "release_allowed" output is "true"

  Scenario: The gated publish job stays a dry-run in this slice
    Given the CI workflow's "publish" job
    When its steps are inspected
    Then it runs the publish path as "npm publish --dry-run"
    And it requires no npm token secret to run
