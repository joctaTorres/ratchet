Feature: Hold-out tag resolution
  As ratchet's eval set
  I want each case's hold-out status derived from an in-file @holdout Gherkin tag
  So that later apply-time filtering, `eval set` reporting, and a `--holdout` scope
    filter all have one pure, shared source of truth for "is this case held out"

  Background:
    Given an eval case enumerated from a .feature file

  Scenario: A Scenario tagged @holdout resolves as held out
    Given a Scenario tagged "@holdout" in its source .feature file
    When the hold-out resolver evaluates the case
    Then the case resolves with holdout status true

  Scenario: A Scenario with no @holdout tag resolves as not held out
    Given a Scenario with no tags
    When the hold-out resolver evaluates the case
    Then the case resolves with holdout status false

  Scenario: A Scenario carrying other tags but not @holdout resolves as not held out
    Given a Scenario tagged "@wip" and "@smoke" but not "@holdout"
    When the hold-out resolver evaluates the case
    Then the case resolves with holdout status false

  Scenario: A Scenario tagged both @holdout and @skip resolves as held out
    Given a Scenario tagged "@holdout" and "@skip" in its source .feature file
    When the hold-out resolver evaluates the case
    Then the case resolves with holdout status true
    And the resolver's holdout status is independent of the case's skip status
