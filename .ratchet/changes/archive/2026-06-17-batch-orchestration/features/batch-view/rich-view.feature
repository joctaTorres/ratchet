Feature: Rich terminal view for batches
  As a developer reviewing batch progress
  I want a rich dashboard for a batch, in the style of ratchet view
  So that I can see ordering, per-change progress, and what is actionable at a glance

  Scenario: View a single batch in detail
    Given a batch "q3-auth" with done, in-progress, ready, and blocked changes
    When I run "ratchet batch view q3-auth"
    Then the view renders the batch name and aggregate progress
    And each change is shown with a status symbol, task progress bar, and its after edges
    And ready changes are visually distinguished from blocked ones

  Scenario: List all batches
    Given batches "q3-auth" and "perf-sweep" exist under .ratchet/batches
    When I run "ratchet batch list"
    Then each batch is listed with its change count and aggregate progress

  Scenario: Viewing a batch with no changes yet
    Given a freshly scaffolded batch "empty-batch"
    When I run "ratchet batch view empty-batch"
    Then the view renders without error
    And it hints how to add changes to the manifest

  Scenario: View respects --no-color
    Given a batch "q3-auth" exists
    When I run "ratchet --no-color batch view q3-auth"
    Then the output contains no ANSI color escape codes
