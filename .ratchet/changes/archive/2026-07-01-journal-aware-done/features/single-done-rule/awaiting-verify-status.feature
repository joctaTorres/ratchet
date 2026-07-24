Feature: A change with all tasks checked but no journaled verify is awaiting-verify, not done
  As the batch engine computing change status from disk + journal
  I want "done" to mean tasks complete AND a journaled verify completion
  So that batch status, step selection, and the next-transition logic share one
  definition of done (delegated-lifecycle: "'Done' has one definition" — computed
  in one place and honored by every consumer; status must not mark a change done
  on task-checkboxes alone while transition still expects a journaled verify gate).

  # PRIOR STATE (defect): `deriveChangeBase` in src/core/batch/status.ts computes
  #   done = progress.total > 0 && progress.completed === progress.total
  # — task checkboxes ALONE, never consulting the run journal. Meanwhile
  # `computeNextTransition` in src/core/batch/engine/transition.ts treats a change
  # whose tasks are all checked but has NO journaled verify completion as needing
  # `verify`. The two rules diverge: status reports such a change `done` while the
  # transition logic says verify still must run. This change collapses them to one
  # journal-aware rule and surfaces the in-between state as `awaiting-verify`.

  Background:
    Given a batch phase containing a change "journal-aware-done" whose plan.md
      has a "## Tasks" checklist
    And the batch run journal for that change

  Scenario: all tasks checked but no journaled verify completion is awaiting-verify
    Given every task checkbox in the change's plan.md is checked "- [x]"
    And the run journal has NO completion entry with transition "verify" for the change
    When the batch status is computed
    Then the change status is "awaiting-verify"
    And the change status is NOT "done"

  Scenario: all tasks checked AND a journaled verify completion is done
    Given every task checkbox in the change's plan.md is checked "- [x]"
    And the run journal has a completion entry with transition "verify" for the change
    When the batch status is computed
    Then the change status is "done"

  Scenario: a partially-checked plan stays in-progress regardless of the journal
    Given the change's plan.md has some checked and some unchecked task checkboxes
    And the run journal has NO completion entry with transition "verify" for the change
    When the batch status is computed
    Then the change status is "in-progress"
    And the change status is neither "awaiting-verify" nor "done"

  # An archived change is terminal and must remain done — the journal-aware rule
  # must not regress the archive shortcut.
  Scenario: an archived change remains done
    Given the change has been archived
    When the batch status is computed
    Then the change status is "done"

  # Regression guard: the new state must not perturb ready/blocked derivation for
  # changes that have not yet been applied.
  Scenario: existing ready and blocked states are preserved
    Given a not-yet-created change with no unmet dependencies
    And a not-yet-created change with an unmet dependency
    When the batch status is computed
    Then the first change status is "ready"
    And the second change status is "blocked"
    And neither is reported "awaiting-verify"
