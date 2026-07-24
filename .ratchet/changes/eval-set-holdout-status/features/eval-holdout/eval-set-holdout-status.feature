Feature: Hold-out status in `eval set`
  As a person reviewing an eval suite for anti-overfitting coverage
  I want `ratchet eval set` to report each case's hold-out status
  So that I can see which cases are held out without inspecting `.feature` files directly, the same way I already see each case's binding status

  Background:
    Given a feature store with one case tagged "@holdout" and one case with no tags

  Scenario: A held-out case reports its hold-out status in JSON
    When I run `ratchet eval set --json`
    Then the held-out case's JSON entry reports "holdout": true
    And the other case's JSON entry reports "holdout": false

  Scenario: A held-out case is tagged in the text report
    When I run `ratchet eval set`
    Then the held-out case's line includes a "[holdout]" tag
    And the other case's line does not include a "[holdout]" tag

  Scenario: Hold-out status is reported alongside binding status, not instead of it
    Given the held-out case is also bound to a deterministic check
    When I run `ratchet eval set`
    Then the held-out case's line includes both its "[deterministic]" binding tag and a "[holdout]" tag

  Scenario: Hold-out reporting does not change gating, aggregation, or the persisted run
    Given the held-out case is bound to a deterministic check
    When I run `ratchet eval run`
    Then the held-out case is judged and gated exactly like any other bound case
    And its persisted run record carries no field beyond today's run JSON shape
