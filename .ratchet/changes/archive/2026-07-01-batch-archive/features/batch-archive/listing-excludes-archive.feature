Feature: Active batch listings exclude archived batches
  As an author scanning my active work
  I want archived batches to drop out of the active batch list
  So that "ratchet batch list" only shows batches still in flight

  Background:
    Given an active batch "rex-agent-runtime"
    And an archived batch at ".ratchet/batches/archive/2026-06-17-old-batch"

  Scenario: List omits the archive directory and its contents
    When I run "ratchet batch list"
    Then "rex-agent-runtime" is listed
    And "old-batch" is not listed
    And the "archive" directory is not listed as a batch

  Scenario: Resolving a single batch never resolves to the archive directory
    Given there is no active batch directory other than "rex-agent-runtime"
    When I run "ratchet batch view" with no name
    Then it resolves to "rex-agent-runtime"
    And it never treats "archive" as the sole batch
