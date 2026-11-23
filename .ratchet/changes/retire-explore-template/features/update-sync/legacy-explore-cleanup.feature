Feature: Legacy explore artifacts are cleaned up on update
  As a developer whose project was initialized while explore artifacts shipped
  I want update to keep removing legacy explore command artifacts
  So that retiring the explore template never strands stale explore files in
  my configured tools

  Background:
    Given a project already initialized with ratchet

  Scenario: Legacy directory-based explore command is removed on forced update
    Given a legacy ".claude/commands/ratchet" command directory containing an
      explore command file
    When I run "ratchet update --force"
    Then the legacy explore command directory is removed

  Scenario: Legacy file-based explore command is removed on forced update
    Given a legacy ".cursor/commands/ratchet-explore.md" command file
    When I run "ratchet update --force"
    Then the legacy explore command file is removed
