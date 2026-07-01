Feature: Invariant kinds evaluator
  As ratchet's eval gate
  I want an evaluator that computes a per-invariant outcome for each of the three
  invariant kinds
  So that an active invariant the run violates — or one that cannot be evaluated
  at all — is recorded as a hard violation instead of silently passing

  # This is the evaluator slice of the invariant set: given a single loaded
  # invariant plus the run state (and, for monotonic, the baseline run), it
  # computes one pass / fail / unevaluable outcome and records the invariant's
  # measure and evidence. It evaluates one invariant at a time; wiring the
  # evaluator into the `invariants` gate contributor over the loaded manifest is
  # the downstream change. The governing rule for every kind is fail-closed: any
  # invariant that cannot be evaluated is a violation, never a pass.

  Background:
    Given an eval run and the project it was produced in

  # --- deterministic kind: an absolute predicate over run state ---------------

  Scenario: A deterministic invariant whose predicate holds passes
    Given an active deterministic invariant whose check command meets its pass condition
    When the invariant is evaluated against the run
    Then the invariant outcome is pass
    And the outcome records the pass condition that was met as its evidence

  Scenario: A deterministic invariant whose predicate fails is a violation
    Given an active deterministic invariant whose check command does not meet its pass condition
    When the invariant is evaluated against the run
    Then the invariant outcome is fail
    And the outcome records the predicate output as evidence of the violation

  Scenario: A deterministic invariant whose predicate cannot run fails closed
    Given an active deterministic invariant whose check command errors before producing a result
    When the invariant is evaluated against the run
    Then the invariant outcome is unevaluable
    And the unevaluable outcome counts as a violation, not a pass
    And the outcome records why the predicate could not be evaluated

  # --- monotonic kind: a measure that must not decrease vs the baseline -------

  Scenario: A monotonic measure that has not decreased versus the baseline passes
    Given a baseline run whose recorded measure is some value
    And an active monotonic invariant whose current measure is greater than or equal to the baseline value
    When the invariant is evaluated against the run
    Then the invariant outcome is pass
    And the outcome records the current measure and the baseline value it was compared to

  Scenario: A monotonic measure that has decreased versus the baseline is a violation
    Given a baseline run whose recorded measure is some value
    And an active monotonic invariant whose current measure is less than the baseline value
    When the invariant is evaluated against the run
    Then the invariant outcome is fail
    And the outcome records the current measure and the baseline value it was compared to

  Scenario: A monotonic invariant with no baseline measure fails closed
    Given an active monotonic invariant whose baseline measure is missing
    When the invariant is evaluated against the run
    Then the invariant outcome is unevaluable
    And the unevaluable outcome counts as a violation, not a pass
    And the outcome records that the baseline measure was missing

  Scenario: A monotonic invariant naming an unknown measure fails closed
    Given an active monotonic invariant whose measure name cannot be resolved over the run
    When the invariant is evaluated against the run
    Then the invariant outcome is unevaluable
    And the unevaluable outcome counts as a violation, not a pass

  # --- snapshot kind: current output diffed against a checked-in golden --------

  Scenario: A snapshot whose produced output matches the golden passes
    Given a checked-in golden
    And an active snapshot invariant whose produce command emits output equal to the golden
    When the invariant is evaluated against the run
    Then the invariant outcome is pass
    And the outcome records that the produced output matched the golden

  Scenario: A snapshot whose produced output differs from the golden is a violation
    Given a checked-in golden
    And an active snapshot invariant whose produce command emits output that differs from the golden
    When the invariant is evaluated against the run
    Then the invariant outcome is fail
    And the outcome records the mismatch as evidence of the violation

  Scenario: A snapshot invariant whose golden is absent fails closed
    Given an active snapshot invariant whose checked-in golden does not exist
    When the invariant is evaluated against the run
    Then the invariant outcome is unevaluable
    And the unevaluable outcome counts as a violation, not a pass
    And the outcome records that the golden was absent
