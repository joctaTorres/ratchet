Feature: Doctor runs on first init only
  As a new ratchet user
  I want init to run doctor automatically the first time
  So that I discover missing external dependencies right after setup, only once

  Scenario: First init runs doctor
    Given a project where ratchet has never been initialized
    When I run "ratchet init"
    Then init performs its normal setup
    And doctor runs automatically as part of init
    And the dependency checks are shown to me

  Scenario: A later init does not re-run doctor
    Given a project where ratchet init has already completed once
    When I run "ratchet init" again
    Then init performs its normal setup
    And doctor does not run automatically

  Scenario: A failing doctor does not abort first-time setup
    Given a project where ratchet has never been initialized
    And a required external dependency is missing
    When I run "ratchet init"
    Then init completes its setup successfully
    And doctor reports the missing dependency as a warning during init
    And I am told I can re-run the checks with "ratchet doctor"

  Scenario: Non-interactive first init still does not block on doctor
    Given a project where ratchet has never been initialized
    And the session is non-interactive
    When I run "ratchet init --tools claude"
    Then init completes its setup successfully
    And doctor never prompts and never blocks the run
