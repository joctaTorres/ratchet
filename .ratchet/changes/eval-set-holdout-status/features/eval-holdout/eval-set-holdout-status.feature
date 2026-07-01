Feature: Hold-out status in `eval set`
  As a person reviewing an eval suite for anti-overfitting coverage
  I want `ratchet eval set` to report each case's hold-out status
  So that I can see which cases are held out without inspecting `.feature` files directly, the same way I already see each case's binding status

  # Third of four changes in the holdout-scenarios phase, building on the pure
  # resolveHoldout() resolver from holdout-tag-resolution. This slice only wires
  # that resolver's output into `ratchet eval set`'s existing JSON/text report —
  # it does not add a `--holdout`/`--no-holdout` CLI scope filter (that is the
  # phase's next, sibling change, holdout-scope-filter) and it does not touch
  # `enumerateEvalSet()`, binding resolution, `eval run`, aggregation, or the
  # persisted run JSON shape, which already gate a held-out case normally per
  # apply-spec-holdout-filter.

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
