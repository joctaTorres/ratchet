Feature: Failure evidence capture for web-bound cases
  As the eval harness
  I want a failed `web`-bound case to persist the Playwright trace and screenshot it
  captured as durable run evidence
  So that the failure is reproducible from the run record alone, without re-running
  the app or digging through a throwaway fixture working copy

  Background:
    Given a `web`-bound case executed through `ratchet eval run`

  Scenario: A failing case's captured trace is persisted as run evidence
    Given a web binding whose Playwright spec fails and reports a captured trace attachment
    When the case is judged and the run is persisted
    Then the case's record carries the trace at a path under the run's own evidence directory
    And the trace file exists at that path after the run completes

  Scenario: A failing case's captured screenshot is persisted as run evidence
    Given a web binding whose Playwright spec fails and reports a captured screenshot attachment
    When the case is judged and the run is persisted
    Then the case's record carries the screenshot at a path under the run's own evidence directory
    And the screenshot file exists at that path after the run completes

  Scenario: A passing case captures no artifact
    Given a web binding whose Playwright spec passes
    When the case is judged and the run is persisted
    Then the case's record carries no trace or screenshot path

  Scenario: A readiness timeout captures no artifact
    Given a web binding whose readiness probe never succeeds before its timeout
    When the case is judged
    Then the case fails on the readiness timeout without ever running the Playwright spec
    And the case's record carries no trace or screenshot path

  Scenario: Persisted evidence outlives the throwaway fixture working copy
    Given a failing web-bound case whose trace and screenshot were captured into its
      throwaway fixture working copy
    When the run is persisted
    Then the captured files are copied into a durable directory under the run's own
      evidence tree, named by the run id and the case id
    And the case's record path is relative to the project root and points at that
      durable copy, not the ephemeral fixture working copy

  Scenario: The report surfaces a failing case's captured evidence paths
    Given a persisted run with a failing web-bound case that captured a trace and a
      screenshot
    When the eval report is built
    Then the report lists that case's trace and screenshot paths alongside its
      rubric, clauses, and votes
