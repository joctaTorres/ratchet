Feature: Hold-out scope filter
  As a person or CI job validating anti-overfitting coverage
  I want `--holdout` / `--no-holdout` flags on `ratchet eval run` and `ratchet eval set`
  So that I can execute or list only the held-out set, or only the non-held-out
    set, composing with the existing scope flags, without altering gate or
    aggregation logic

  # Fourth and last of four changes in the holdout-scenarios phase, building on
  # the pure resolveHoldout() resolver from holdout-tag-resolution (already
  # reported per-case by eval-set-holdout-status). This slice adds the CLI
  # scope filter only: it does not change resolveHoldout(), filterHoldoutContent(),
  # apply-time spec filtering, binding resolution, judging, aggregation, or the
  # persisted run JSON shape (EvalRun.scope / CaseSnapshot are untouched) — a
  # held-out case that is in scope is judged and gated exactly as it is today.

  Background:
    Given a feature store with one case tagged "@holdout" and one case with no tags

  Scenario: `eval set --holdout` lists only the held-out case
    When I run `ratchet eval set --holdout --json`
    Then the JSON case list contains only the held-out case

  Scenario: `eval set --no-holdout` excludes the held-out case
    When I run `ratchet eval set --no-holdout --json`
    Then the JSON case list contains only the non-held-out case

  Scenario: Omitting the flag leaves every in-scope case, exactly as today
    When I run `ratchet eval set --json` with neither hold-out flag
    Then the JSON case list contains both cases

  Scenario: `eval run --holdout` judges and persists only the held-out case
    Given the held-out case is bound to a deterministic check
    When I run `ratchet eval run --holdout`
    Then the persisted run's cases include only the held-out case
    And the held-out case is judged and gated exactly like any other bound case

  Scenario: `eval run --no-holdout` excludes the held-out case from the run
    Given the held-out case is bound to a deterministic check
    When I run `ratchet eval run --no-holdout`
    Then the persisted run's cases include only the non-held-out case

  Scenario: The hold-out filter composes with an existing scope flag
    Given a change with its own held-out and non-held-out cases, separate from the feature store
    When I run `ratchet eval set --change <name> --holdout --json`
    Then the JSON case list contains only the held-out case scoped to that change
