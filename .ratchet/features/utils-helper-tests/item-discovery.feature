Feature: item-discovery helpers are proven by fixture-isolated tests
  As a maintainer holding ratchet to the testing standard
  I want the discovery helpers in src/utils/item-discovery.ts under test
  So that the active-change, feature-store, and archived-change listings are
    pinned to their filtering and sorting contract

  Background:
    Given an isolated project tree built under fs.mkdtemp(os.tmpdir())
    And only the minimal .ratchet/ tree each scenario exercises is written
    And the fixture is removed in afterEach so no artifacts leak

  Scenario: getActiveChangeIds lists only directories carrying change metadata, sorted
    Given a changes/ dir with metadata-bearing change dirs, a metadata-less dir,
      a dotfile entry, and the archive/ dir
    When getActiveChangeIds runs
    Then it returns only the metadata-bearing change ids, sorted, excluding the
      metadata-less dir, the dotfile, and archive

  Scenario: getActiveChangeIds returns empty when there is no changes directory
    Given a project root with no .ratchet/changes directory
    When getActiveChangeIds runs
    Then it returns an empty list

  Scenario: getSpecIds lists top-level feature-store capabilities, sorted
    Given a features/ dir with capability subdirectories and a dotfile entry
    When getSpecIds runs
    Then it returns the capability ids sorted, excluding the dotfile

  Scenario: getSpecIds returns empty when there is no features directory
    Given a project root with no .ratchet/features directory
    When getSpecIds runs
    Then it returns an empty list

  Scenario: getArchivedChangeIds lists only archived dirs carrying change metadata, sorted
    Given an archive/ dir with metadata-bearing change dirs, a metadata-less dir,
      and a dotfile entry
    When getArchivedChangeIds runs
    Then it returns only the metadata-bearing archived ids, sorted

  Scenario: getArchivedChangeIds returns empty when there is no archive directory
    Given a project root with no .ratchet/changes/archive directory
    When getArchivedChangeIds runs
    Then it returns an empty list
