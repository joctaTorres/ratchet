Feature: Playwright installation detection
  As a ratchet user with at least one web-bound eval case
  I want doctor to tell me whether the Playwright CLI is usable
  So that I know to install it before running web-bound eval cases

  Background:
    Given a project whose eval specs contain at least one "kind: web" binding

  Scenario: Playwright CLI is installed
    Given the Playwright CLI is resolvable and reports a version
    When ratchet doctor runs
    Then the "playwright" check has status "pass"
    And the check's detail includes the detected Playwright version

  Scenario: Playwright CLI is not installed
    Given the Playwright CLI is not resolvable
    When ratchet doctor runs
    Then the "playwright" check has status "info"
    And the check's remedy explains how to install Playwright

  Scenario: A missing Playwright CLI never fails doctor
    Given the Playwright CLI is not resolvable
    When ratchet doctor runs
    Then the "playwright" check has severity "optional"
    And the process exit code is unaffected by the "playwright" check's status

  Scenario: JSON output includes the playwright check like any other check
    Given the Playwright CLI is not resolvable
    When ratchet doctor runs with the "--json" option
    Then the JSON checks array includes an entry with id "playwright"
    And that entry has the same shape as the "docker" check entry
