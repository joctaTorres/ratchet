Feature: Judge eval cases through the batch engine
  As the eval runner
  I want to reuse the batch engine's judging seams instead of new logic
  So that deterministic checks and agent verdicts share one tested backend

  Scenario: A check case is judged deterministically against its fixture
    Given a bound "check" case with pass condition "contains:applyRequires"
    When the case is judged
    Then the engine's bash runner runs the command in the fixture working copy
    And the engine's pass-condition evaluator decides pass or fail

  Scenario: An agent case is judged by a fresh spawned agent
    Given a bound "agent" case
    When the case is judged
    Then a fresh coding-agent subprocess is spawned through the engine adapter
    And it runs in the fixture working copy with instructions built from the scenario and success criteria
    And its pass or fail verdict and reason are captured

  Scenario: The judge mode is selectable on the command
    Given an eval set with check and agent bindings
    When I run "ratchet eval run --judge check"
    Then only deterministic checks are run
    And agent-only cases are left unjudged

  Scenario: The default judge mode follows each case's bound kind
    Given an eval set whose bindings mix check and agent kinds
    When I run "ratchet eval run" without a judge flag
    Then each case is judged by the kind its binding declares

  Scenario: The agent judge fails closed when evidence is missing
    Given a bound "agent" case whose spawned judge finds no concrete evidence for the outcome
    When the verdict is captured
    Then the case is not recorded as a pass
    And the missing evidence is named in the reason

  Scenario: An agent case is judged by repeat votes
    Given a bound "agent" case declaring three votes
    When the case is judged
    Then the judge is spawned three times against the fixture working copy
    And the majority verdict is recorded

  Scenario: A flaky agent verdict is unjudged, never a failure
    Given a bound "agent" case whose repeat votes disagree
    When the verdict is resolved
    Then the case is recorded as "unjudged" with the disagreement noted
    And it is never recorded as a fail

  Scenario: No judge touches the live repository
    Given any bound case
    When it is judged by either mode
    Then the judging command's working directory is the case fixture working copy
    And no judgment reads or mutates the host repository state
