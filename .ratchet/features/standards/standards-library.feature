Feature: Standards library
  As a developer setting up ratchet
  I want a project-level place to keep my engineering standards
  So that every change is proposed and verified against the same guidelines

  Background:
    Given a project that uses ratchet

  Scenario: Init scaffolds an empty standards directory in a fresh project
    Given a directory with no ".ratchet/" folder
    When I run "ratchet init"
    Then a ".ratchet/standards/" directory exists
    And the ".ratchet/standards/" directory contains no standard files
    And the directory sits alongside ".ratchet/features/" and ".ratchet/changes/"

  Scenario: Init backfills the standards directory for an already-initialized project
    Given a project that was initialized before standards existed
    And the project has no ".ratchet/standards/" directory
    When I run "ratchet init" again
    Then a ".ratchet/standards/" directory exists
    And my existing features and changes are left untouched

  Scenario: Re-running init never discards authored standards
    Given a ".ratchet/standards/" directory containing "testing.md"
    When I run "ratchet init" again
    Then the ".ratchet/standards/" directory still contains "testing.md"
    And the contents of "testing.md" are unchanged

  Scenario: Standards may cover any concern
    Given a ".ratchet/standards/" directory
    When I add standard files named "testing.md", "security.md", and "architecture.md"
    Then ratchet treats each file as a standard
    And no fixed set of standard names is required
