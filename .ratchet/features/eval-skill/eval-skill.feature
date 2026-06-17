Feature: Generated /rct:eval agent skill
  As a developer using any supported coding agent
  I want an /rct:eval skill that runs the eval and closes coverage gaps
  So that judging stays engine-backed while authoring stays guided

  Scenario: The skill is generated for every supported agent
    Given a project initialized with "ratchet init"
    When skills and commands are generated
    Then an /rct:eval skill is rendered for every agent in the supported-tools registry
    And its body is defined once as shared tool-agnostic content

  Scenario: The skill runs the engine-backed eval, not inline judging
    Given an agent invoking /rct:eval
    When the skill runs
    Then it executes "ratchet eval run" so the engine judges each bound case
    And it presents "ratchet eval report" for the run
    And it does not form verdicts by reading the live repository itself

  Scenario: The skill helps author bindings for unjudged cases
    Given a report listing unjudged cases
    When the skill processes them
    Then it guides authoring an eval-spec binding with a fixture and a check
    And it prefers a deterministic check, falling back to an agent binding with success criteria

  Scenario: Regressions are surfaced as the headline outcome
    Given a run whose report flags a regression against the baseline
    When the skill summarizes the run
    Then it reports the regression and the failing case evidence first
    And it does not promote the run to baseline while a regression exists
