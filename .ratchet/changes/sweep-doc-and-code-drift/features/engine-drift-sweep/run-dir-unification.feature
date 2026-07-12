Feature: One batch run directory
  As a batch operator inspecting run state
  I want the lock, journal, and sidecar prompt dirs to share one batch run location
  So that a batch has a single run directory instead of `run/` and `.run/` siblings

  Scenario: sidecar prompt dirs live under the batch run directory
    Given a batch step spawns an agent through the ReX sidecar runtime
    When the runtime materializes the prompt file for a run id
    Then the prompt file is written under ".ratchet/batches/<batch>/run/<id>/"
    And the batch lock and journal live in that same ".ratchet/batches/<batch>/run/" directory

  Scenario: unified run directory stays out of version control
    Given ".gitignore" ignores ".ratchet/batches/*/run/"
    When a sidecar step materializes its prompt dir under the unified location
    Then the prompt dir is covered by the existing ignore rule
    And no ".ratchet/batches/<batch>/.run/" sibling is created
