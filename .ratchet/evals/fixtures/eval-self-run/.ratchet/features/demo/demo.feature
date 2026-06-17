Feature: Demo self-run
  As a ratchet user
  I want a tiny deterministic eval
  So that the host agent judge has something real to observe

  Scenario: The marker file is present in the working copy
    Given a materialized fixture working copy
    When the check runs in that copy
    Then the marker file exists
