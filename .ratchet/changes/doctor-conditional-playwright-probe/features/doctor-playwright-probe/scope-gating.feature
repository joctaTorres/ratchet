Feature: Conditional Playwright probe scope gating
  As a ratchet user who may or may not use web-bound eval cases
  I want `ratchet doctor` to probe for Playwright only when it is relevant
  So that the report never asks me to install a dependency I don't need

  Scenario: No web binding anywhere in the resolved eval bindings
    Given a project whose eval specs contain only "deterministic" and "llm-judge" bindings
    When ratchet doctor runs
    Then the report's checks do not include a check with id "playwright"

  Scenario: A web binding is present among the resolved eval bindings
    Given a project whose eval specs contain at least one "kind: web" binding
    When ratchet doctor runs
    Then the report's checks include a check with id "playwright"

  Scenario: A project with no eval specs at all
    Given a project with no ".ratchet/evals/specs" directory
    When ratchet doctor runs
    Then the report's checks do not include a check with id "playwright"

  Scenario: An invalid eval spec file that resolves no bindings
    Given a project whose eval specs directory contains a file that fails to parse
    And none of the file's entries resolve to a valid binding
    When ratchet doctor runs
    Then the report's checks do not include a check with id "playwright"
