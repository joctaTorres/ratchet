Feature: ratchet init ignores transient eval run records
  As a ratchet user initializing a project
  I want the transient eval run directory ignored by git
  So that persisted run records never dirty my working tree or the mutation gate

  Scenario: init adds the eval runs directory to .gitignore
    Given a project without a .gitignore entry for eval run records
    When I run "ratchet init"
    Then the project .gitignore contains an entry ignoring .ratchet/evals/runs/

  Scenario: init does not duplicate an existing ignore entry
    Given a project whose .gitignore already ignores .ratchet/evals/runs/
    When I run "ratchet init"
    Then the .gitignore still contains a single entry ignoring .ratchet/evals/runs/
