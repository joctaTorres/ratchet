Feature: Phase proof — a real publish lands on a registry and npx runs the published CLI
  As a maintainer
  I want the blackbox publish harness to perform a REAL publish to a staged registry and then run the package via npx
  So that I can see, end to end, that a green build on "main" actually publishes ratchet-ai and that `npx ratchet-ai --version` executes the freshly published CLI — while a red gate or a non-main ref publishes nothing

  Scenario: A green build on main publishes to the staged registry and npx runs the published CLI
    Given the package is built
    And a staged npm registry is running
    And the release gate ALLOWs on "main" with every wired gate green
    And the local version is not yet on the staged registry
    When the gated publish path runs against the staged registry
    Then the version guard reports should_publish "true"
    And a real "npm publish" uploads the package to the staged registry
    And running "npx ratchet-ai --version" against the staged registry executes the published CLI
    And the version it prints matches the published version

  Scenario: Re-running the already-published version is a green, idempotent SKIP via the real registry query
    Given the package has just been published to the staged registry
    And the release gate ALLOWs on "main" with every wired gate green
    When the version guard runs with its registry source pointed at the staged registry
    Then it sees the local version as already published
    And it reports should_publish "false"
    And no second publish is attempted
    And the version guard exits zero so the re-run does not error the pipeline

  Scenario: A forced red wired gate publishes nothing
    Given the package is built
    And a staged npm registry is running
    And the release gate runs on "main" with a forced red wired gate
    When the gated publish path runs against the staged registry
    Then the runner records "release_allowed=false"
    And the publish path is not reached
    And nothing is uploaded to the staged registry

  Scenario: A non-main ref publishes nothing
    Given the package is built
    And a staged npm registry is running
    And the release gate runs on a non-main branch with every wired gate green
    When the gated publish path runs against the staged registry
    Then the runner records "release_allowed=false"
    And the publish path is not reached
    And nothing is uploaded to the staged registry
