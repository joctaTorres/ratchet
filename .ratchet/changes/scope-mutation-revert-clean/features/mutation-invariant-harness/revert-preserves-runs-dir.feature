Feature: Mutation harness revert preserves ratchet's transient run records
  As a ratchet user whose repo tracks .ratchet/ without gitignoring the runs dir
  I want the per-attempt revert to leave ratchet's own run records intact
  So that reverting a seeded mutant never deletes the eval run in progress

  Background:
    Given a mutation invariant seeding attempt that must be reverted

  Scenario: The revert clean step excludes ratchet's transient runs directory
    Given an untracked run record exists under .ratchet/evals/runs/
    When the harness reverts the working tree after an attempt
    Then the seeded mutant is removed from the working tree
    And the untracked run record under .ratchet/evals/runs/ is preserved
