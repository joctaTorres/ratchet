Feature: PR group boundary detection
  As the ratchet batch engine
  I want a pure function that maps a batch's ordered phases/changes and the
  resolved PR grouping mode to the ordered list of PR group boundaries, each
  with a stable group identity
  So that downstream stacked-base selection and per-boundary spawning have one
  authoritative, deterministic source of "where the PR groups are" — computed
  with no filesystem access and no agent spawn

  Scenario: off yields no boundaries
    Given a batch "demo" whose phases and changes are, in order, p1:[a, b] and p2:[c]
    When boundaries are detected for grouping mode "off"
    Then no PR group boundaries are produced

  Scenario: whole-batch yields a single boundary spanning every change
    Given a batch "demo" whose phases and changes are, in order, p1:[a, b] and p2:[c]
    When boundaries are detected for grouping mode "whole-batch"
    Then exactly one PR group boundary is produced
    And its kind is "batch"
    And its group identity is the batch name "demo"
    And its member changes are "a, b, c" in order
    And its trigger change is the batch's last change "c"
    And its group index is 0

  Scenario: per-phase yields one boundary per phase, each named by its phase
    Given a batch "demo" whose phases and changes are, in order, p1:[a, b] and p2:[c]
    When boundaries are detected for grouping mode "per-phase"
    Then exactly 2 PR group boundaries are produced in order
    And boundary 0 has kind "phase", identity "p1", member changes "a, b", trigger change "b"
    And boundary 1 has kind "phase", identity "p2", member changes "c", trigger change "c"

  Scenario: per-change yields one boundary per change, each named by its change
    Given a batch "demo" whose phases and changes are, in order, p1:[a, b] and p2:[c]
    When boundaries are detected for grouping mode "per-change"
    Then exactly 3 PR group boundaries are produced in order
    And boundary 0 has kind "change", identity "a", member changes "a", trigger change "a"
    And boundary 1 has kind "change", identity "b", member changes "b", trigger change "b"
    And boundary 2 has kind "change", identity "c", member changes "c", trigger change "c"

  Scenario: group indices are contiguous and 0-based for stacked-base consumption
    Given a batch "demo" whose phases and changes are, in order, p1:[a, b] and p2:[c]
    When boundaries are detected for grouping mode "per-change"
    Then the produced boundaries carry group indices "0, 1, 2" in order
    And every group identity is unique

  Scenario: per-phase skips a phase that has no changes
    Given a batch "sparse" whose phases and changes are, in order, p1:[a], p2:[] and p3:[c]
    When boundaries are detected for grouping mode "per-phase"
    Then exactly 2 PR group boundaries are produced in order
    And boundary 0 has kind "phase", identity "p1", member changes "a", trigger change "a"
    And boundary 1 has kind "phase", identity "p3", member changes "c", trigger change "c"

  Scenario Outline: an empty batch produces no boundaries under any mode
    Given a batch "empty" with no changes in any phase
    When boundaries are detected for grouping mode "<mode>"
    Then no PR group boundaries are produced

    Examples:
      | mode        |
      | off         |
      | whole-batch |
      | per-phase   |
      | per-change  |

  Scenario: detection reads only in-memory batch state
    Given a batch "demo" whose phases and changes are, in order, p1:[a, b] and p2:[c]
    When boundaries are detected for grouping mode "per-phase"
    Then the result is computed purely from the given phases and mode
    And no filesystem is read and no agent is spawned
