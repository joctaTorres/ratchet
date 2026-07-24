Feature: Archive a completed batch
  As an author who has finished a batch
  I want to archive it with a single command
  So that finished batches stop cluttering the active batch list and are
  preserved with their manifest and run journal for the record

  Background:
    Given a project with a batch "rex-agent-runtime" at ".ratchet/batches/rex-agent-runtime/"
    And the batch manifest declares change intents across its phases

  Scenario: Archiving a done batch moves it under the archive directory
    Given every change intent in the batch is done
    When I run "ratchet batch archive rex-agent-runtime"
    Then the directory ".ratchet/batches/rex-agent-runtime" no longer exists
    And a directory ".ratchet/batches/archive/2026-06-17-rex-agent-runtime" exists
    And it contains the batch manifest "batch.yaml"
    And it contains the batch run journal

  Scenario: Archiving cascades the change-archive flow to each member change
    Given the batch has member changes "engine-runtime" and "rex-bootstrap"
    And both member changes are done but not yet archived
    When I run "ratchet batch archive rex-agent-runtime --yes"
    Then each member change has its features applied to the permanent feature store
    And each member change has its standard links materialized
    And each member change directory is moved to ".ratchet/changes/archive/"
    And then the batch directory is moved to ".ratchet/batches/archive/"

  Scenario: Member changes are archived in phase order
    Given the batch declares phase "foundation" before phase "runtime"
    And "foundation" contains change "engine-runtime" and "runtime" contains change "rex-bootstrap"
    When I run "ratchet batch archive rex-agent-runtime --yes"
    Then "engine-runtime" is archived before "rex-bootstrap"

  Scenario: Already-archived member changes are skipped, not re-archived
    Given member change "engine-runtime" was already archived earlier
    And member change "rex-bootstrap" is done but not yet archived
    When I run "ratchet batch archive rex-agent-runtime --yes"
    Then "engine-runtime" is left untouched in the change archive
    And only "rex-bootstrap" runs through the change-archive flow
    And the command does not error on the already-archived change

  Scenario: Member changes that were never created are skipped
    Given the manifest declares a change intent "future-work" with no change directory
    And every other member change is done
    When I run "ratchet batch archive rex-agent-runtime --yes"
    Then the pending intent "future-work" is skipped without error
    And the batch is archived

  Scenario: Archiving refuses to overwrite an existing archive entry
    Given an archived batch already exists at ".ratchet/batches/archive/2026-06-17-rex-agent-runtime"
    And every change intent in the batch is done
    When I run "ratchet batch archive rex-agent-runtime --yes"
    Then the command fails with an error that the archive entry already exists
    And the active batch directory is left in place

  Scenario: Unknown batch name fails clearly
    Given there is no batch named "ghost-batch"
    When I run "ratchet batch archive ghost-batch"
    Then the command fails with an error that the batch was not found
