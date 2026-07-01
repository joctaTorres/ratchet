Feature: Phase proof — the publish job is reachable only when the gate ALLOWs on main
  As a maintainer
  I want a blackbox harness that drives the release-gate runner and watches the gating decision flow into the publish job
  So that I can see, end to end, that a green build of "main" makes the publish path reachable (as a dry-run) while a forced red gate or a non-main ref skips publish entirely

  Scenario: A green build on main makes the publish path reachable as a dry-run
    Given the package is built
    And the release gate runs on the "main" branch with every wired gate green
    When the release-gate runner is executed and its step output is captured
    Then the runner records "release_allowed=true" in its step output
    And the publish job's gate condition is satisfied
    And the dry-run publish path is exercised and nothing is published

  Scenario: A forced red gate skips the publish path entirely
    Given the package is built
    And the release gate runs on the "main" branch with a forced red wired gate
    When the release-gate runner is executed and its step output is captured
    Then the runner records "release_allowed=false" in its step output
    And the publish job's gate condition is not satisfied
    And the dry-run publish path is not reached

  Scenario: A non-main ref skips the publish path entirely
    Given the package is built
    And the release gate runs on a non-main branch with every wired gate green
    When the release-gate runner is executed and its step output is captured
    Then the runner records "release_allowed=false" in its step output
    And the publish job's gate condition is not satisfied
    And the dry-run publish path is not reached
