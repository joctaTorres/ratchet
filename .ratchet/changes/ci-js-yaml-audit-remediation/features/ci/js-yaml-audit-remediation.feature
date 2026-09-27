Feature: js-yaml GHSA-2883-xcg3-v3hh remediation keeps the dependency-audit gate green
  As a maintainer of PR #113
  I want the transitive js-yaml major-4 override pinned to the patched 4.3.2
  So that the CI dependency-audit gate passes without loosening the gate or its threshold

  Background:
    Given the workspace overrides pin "js-yaml@4" in pnpm-workspace.yaml
    And the dependency-audit gate fails on vulnerabilities at or above its configured threshold

  Scenario: Every resolved js-yaml major-4 install is the patched 4.3.2
    Given the "js-yaml@4" override is set to "4.3.2"
    When the pnpm lockfile is regenerated with "pnpm install"
    Then pnpm-lock.yaml resolves every js-yaml 4.x entry to "4.3.2"
    And no js-yaml 4.x entry resolves to "4.3.1" or lower

  Scenario: The dependency audit no longer reports GHSA-2883-xcg3-v3hh
    Given the lockfile resolves js-yaml 4.x to "4.3.2"
    When "pnpm audit --json" is run and the report is fed to the dependency-audit gate
    Then the report contains no advisory "GHSA-2883-xcg3-v3hh"
    And the dependency-audit gate exits zero

  Scenario: The audit gate and its threshold are unchanged
    Given the remediation change is applied
    When the CI workflow and the dependency-audit gate runner are compared with main
    Then the "Dependency-audit gate" step in .github/workflows/ci.yml is unchanged
    And the gate's failure threshold is unchanged
