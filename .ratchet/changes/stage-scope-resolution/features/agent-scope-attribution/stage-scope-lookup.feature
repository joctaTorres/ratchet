Feature: Per-stage scope attribution for the resolved agent setting
  As the batch engine's failure-attribution surface
  I want to know, per lifecycle stage, which config scope supplied that stage's
  resolved agent[:model] spec string
  So that a model-rejection failure can name the scope (project config vs
  manifest) that supplied the model — without changing how settings resolve

  Background:
    Given the agent setting merges across scopes low-to-high as project then manifest
    And the merge is nearest-wins per stage over the stages propose, apply, verify, and pr

  Scenario: Scalar layering attributes every stage to the supplying scope
    Given a project-config scalar agent "claude" and no manifest agent
    When the per-stage scope attribution is resolved over those layers
    Then every stage is attributed to the "project" scope

  Scenario: Nearer scalar attributes every stage to the nearer scope
    Given a project-config scalar agent "claude"
    And a manifest scalar agent "opencode:zai/glm-5.2"
    When the per-stage scope attribution is resolved over those layers
    Then every stage is attributed to the "manifest" scope

  Scenario: Partial-map layering attributes only the stages the map names
    Given a project-config stage map naming only propose as "claude" and no manifest agent
    When the per-stage scope attribution is resolved over those layers
    Then the propose stage is attributed to the "project" scope
    And the apply, verify, and pr stages carry no scope attribution

  Scenario: Mixed-scope layering attributes each stage to the scope that supplied its spec
    Given a project-config scalar agent "claude"
    And a manifest stage map naming only apply as "opencode:zai/glm-5.2"
    When the per-stage scope attribution is resolved over those layers
    Then the apply stage is attributed to the "manifest" scope
    And the propose, verify, and pr stages are attributed to the "project" scope

  Scenario: Map-over-map layering attributes per stage with nearest-wins
    Given a project-config stage map naming propose as "claude" and apply as "claude"
    And a manifest stage map naming only apply as "opencode"
    When the per-stage scope attribution is resolved over those layers
    Then the propose stage is attributed to the "project" scope
    And the apply stage is attributed to the "manifest" scope
    And the verify and pr stages carry no scope attribution

  Scenario: A nearer scalar resets lower-scope per-stage attributions
    Given a project-config stage map naming only apply as "opencode"
    And a manifest scalar agent "claude"
    When the per-stage scope attribution is resolved over those layers
    Then every stage is attributed to the "manifest" scope

  Scenario: An unset agent setting attributes no stage to any scope
    Given no project-config agent and no manifest agent
    When the per-stage scope attribution is resolved over those layers
    Then no stage carries a scope attribution

  Scenario: Attribution agrees with the resolved merge and leaves it unchanged
    Given any layering of scalar and partial-map agent values across project and manifest scopes
    When both the agent setting and the per-stage scope attribution are resolved over the same layers
    Then the resolved agent setting is byte-for-byte what the existing merge produces
    And for every attributed stage the named scope's layer supplies exactly that stage's resolved agent[:model] spec string
    And every stage whose resolved spec is undefined carries no scope attribution
