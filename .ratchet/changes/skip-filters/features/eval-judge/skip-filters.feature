Feature: Skip filters for the eval gate
  As ratchet's eval gate
  I want a case matching a project skip rule or an in-file @skip tag excluded from judging by default, recorded "skipped" and counted, never silently dropped
  So that intentionally-excluded cases are transparent in the run instead of disappearing or pretending to pass

  # This is the skip-filters slice of judge hardening, independent of (not
  # downstream of) rubric-decomposition and jury-quorum-resolution: it changes
  # WHICH cases reach judging, not how a judged case's votes resolve. Two skip
  # sources are supported: a project-level `eval.skip` config (a list of glob
  # patterns matched against the case id) and an in-file `@skip` Gherkin tag on
  # the Scenario, captured by gherkin-parser.ts (today all tags are discarded).
  # A skipped case is recorded with a new `skipped` status distinct from
  # `unjudged` — `skipped` is an intentional, counted exclusion, never an
  # incompleteness that blocks baseline promotion. `--include-skipped` on
  # `eval run` overrides both sources for that run. Structured persistence of
  # the skip reason/source in the run JSON is the downstream
  # structured-evidence-persistence change's concern; this slice only changes
  # which cases are judged and that the skip is visible.

  Background:
    Given an eval case enumerated from a .feature file

  # --- in-file @skip tag --------------------------------------------------

  Scenario: A Scenario tagged @skip is excluded from judging
    Given a Scenario tagged "@skip" in its source .feature file
    When an eval run executes
    Then the case is recorded with status "skipped"
    And no fixture is materialized and no judge is spawned for the case

  Scenario: A Scenario with no @skip tag and no matching skip config judges normally
    Given a Scenario with no tags and a project with no eval.skip config
    When an eval run executes
    Then the case is judged by its bound kind as usual

  # --- project eval.skip config -------------------------------------------

  Scenario: A case matching a project eval.skip pattern is excluded from judging
    Given a project eval.skip config listing a pattern that matches the case id
    When an eval run executes
    Then the case is recorded with status "skipped"
    And no fixture is materialized and no judge is spawned for the case

  Scenario: A case not matching any project eval.skip pattern judges normally
    Given a project eval.skip config listing a pattern that does not match the case id
    When an eval run executes
    Then the case is judged by its bound kind as usual

  # --- skipped is counted, never silently dropped -------------------------

  Scenario: A skipped case is counted in the run summary
    Given a run with one skipped case and one normally-judged passing case
    When the run summary is computed
    Then the scorecard reports 1 skipped case
    And the scorecard's total still counts the skipped case

  Scenario: A skipped case does not block the run from being complete
    Given a run where every case is either skipped or judged (none unjudged)
    When run completeness is evaluated
    Then the run is complete
    And the run can be promoted to baseline

  # --- --include-skipped overrides both skip sources ----------------------

  Scenario: --include-skipped judges a case that would otherwise be skipped by its @skip tag
    Given a Scenario tagged "@skip" in its source .feature file
    When an eval run executes with --include-skipped
    Then the case is judged by its bound kind as usual, not recorded "skipped"

  Scenario: --include-skipped judges a case that would otherwise be skipped by eval.skip config
    Given a project eval.skip config listing a pattern that matches the case id
    When an eval run executes with --include-skipped
    Then the case is judged by its bound kind as usual, not recorded "skipped"

  # --- baseline-pass-now-skipped warning -----------------------------------

  Scenario: Skipping a case that was passing in the baseline emits a warning
    Given a case whose most recent baseline status was "pass"
    And the case is now skipped by config or tag
    When an eval run executes
    Then a visible warning names the case and that it was previously passing
    And the case is still recorded with status "skipped", not "fail"

  Scenario: Skipping a case with no baseline history emits no skip warning
    Given a case with no entry in the baseline run
    And the case is now skipped by config or tag
    When an eval run executes
    Then no skip warning is emitted for the case
    And the case is recorded with status "skipped"
