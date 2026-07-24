Feature: task-progress helpers are proven by tests
  As a maintainer holding ratchet to the testing standard
  I want the task-counting and status helpers in src/utils/task-progress.ts under test
  So that plan task tallies and their human-readable status are pinned to contract

  Background:
    Given the counting and formatting helpers are deterministic over in-memory inputs
    And filesystem-touching scenarios use an isolated fs.mkdtemp(os.tmpdir()) fixture
      that is removed in afterEach

  Scenario: countTasksFromContent tallies total and completed checklist items
    Given plan content mixing checked and unchecked task lines
    When countTasksFromContent runs
    Then it reports the total task count and the completed count

  Scenario: countTasksFromContent recognizes both bullet styles and case-insensitive marks
    Given task lines using "-" and "*" bullets with "[x]" and "[X]" completion marks
    When countTasksFromContent runs
    Then every task line is counted and the upper- and lower-case marks count as completed

  Scenario: countTasksFromContent ignores non-task lines
    Given content with prose, headings, and no checklist items
    When countTasksFromContent runs
    Then it reports zero total and zero completed

  Scenario: getTaskProgressForChange counts tasks from a change's plan.md
    Given a change directory whose plan.md carries checklist items
    When getTaskProgressForChange runs
    Then it returns the tallied progress from that plan.md

  Scenario: getTaskProgressForChange returns zero progress when plan.md is missing
    Given a change directory with no plan.md
    When getTaskProgressForChange runs
    Then it returns zero total and zero completed

  Scenario: formatTaskStatus reports no tasks
    Given progress with a total of zero
    When formatTaskStatus runs
    Then it returns the "No tasks" label

  Scenario: formatTaskStatus reports completion when all tasks are done
    Given progress where completed equals a non-zero total
    When formatTaskStatus runs
    Then it returns the complete label

  Scenario: formatTaskStatus reports the remaining tally otherwise
    Given progress with some but not all tasks complete
    When formatTaskStatus runs
    Then it returns the "completed/total tasks" label
