Feature: Mutation invariant folds into evaluateInvariant
  As ratchet's per-invariant evaluator
  I want a `kind: mutation` invariant to run the mutation harness and reduce its
  per-mutant kill/survive results to a pass/fail/unevaluable outcome
  So that a survived mutant is a hard, reproducible failure and a test suite that
  can't be trusted (too few mutants evaluated, or the oracle can't run at all)
  is recorded unevaluable — never a silent pass — through the same outcome shape
  every other invariant kind already returns

  Background:
    Given an active mutation invariant with a test command, a budget, and a threshold
    And an eval run and the project it was produced in

  Scenario: Every evaluated mutant is killed
    Given the mutation harness seeds at least `threshold` mutants and every one is killed
    When the invariant is evaluated against the run
    Then the invariant outcome is pass
    And the outcome records how many mutants were evaluated and killed as its evidence

  Scenario: A single survived mutant is a hard failure regardless of how many others were killed
    Given the mutation harness seeds `threshold` or more mutants and exactly one survives
    When the invariant is evaluated against the run
    Then the invariant outcome is fail
    And the outcome's evidence names the survived mutant
    And the outcome is a violation

  Scenario: Fewer mutants evaluated than the invariant's threshold is unevaluable, not a pass
    Given the mutation harness evaluates fewer mutants than the invariant's threshold
    And none of the evaluated mutants survived
    When the invariant is evaluated against the run
    Then the invariant outcome is unevaluable
    And the outcome's evidence cites the threshold that was not met
    And the outcome is a violation

  Scenario: An unusable working tree fails closed to unevaluable
    Given the mutation harness reports the working tree is unusable before seeding anything
    When the invariant is evaluated against the run
    Then the invariant outcome is unevaluable
    And the outcome's evidence cites why the working tree was unusable

  Scenario: A test command that cannot run at all fails closed to unevaluable
    Given the invariant's test command throws instead of producing a result
    When the invariant is evaluated against the run
    Then the invariant outcome is unevaluable
    And the outcome's evidence cites that the test command could not run
    And no mutant is recorded as killed or survived

  Scenario: The mutation outcome gates through the existing invariants contributor unchanged
    Given a run with one active mutation invariant whose evaluation is fail
    When the run is aggregated
    Then the invariants contributor fails
    And the run's contributor ids introduce no new contributor beyond the four built-in ids
