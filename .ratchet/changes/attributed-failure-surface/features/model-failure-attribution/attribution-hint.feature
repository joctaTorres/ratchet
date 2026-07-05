Feature: Attributed model-failure surface
  As a batch operator running per-stage agent[:model] specs
  I want a step that fails fast under an explicitly named model to say which
  stage, agent, exact model string, and config scope it ran under
  So that I can spot an invalid model id without decoding a raw stderr tail

  Background:
    Given the engine parses each transition's resolved agent[:model] spec once per transition
    And batch settings resolution exposes, per stage, which scope supplied that stage's resolved spec
    And the engine feeds the outcome mapper the parsed spec and the stage's supplying scope

  Scenario: Fast failure under an explicit model carries the attribution hint
    Given the apply stage resolves to the spec "opencode:zai/glm-5.2" supplied by the project config
    When the apply transition's agent exits non-zero with no completion report and no journal entries written during the session
    Then the surfaced failed step's detail opens with an attribution hint naming the "apply" stage, the "opencode" agent, the exact model string "zai/glm-5.2", and the project config as the supplying scope
    And the hint is phrased as "if this model id is invalid" guidance, never a diagnosis
    And the captured stderr tail follows below the hint

  Scenario: The hint names the manifest when the manifest supplied the stage's spec
    Given the project config sets a scalar agent "claude"
    And the batch manifest maps the apply stage to "opencode:zai/glm-5.2"
    When the apply transition's agent exits non-zero with no completion report and no journal entries written during the session
    Then the attribution hint names the batch manifest as the supplying scope
    And the hint names the "apply" stage, the "opencode" agent, and the exact model string "zai/glm-5.2"

  Scenario: The hint never interprets stderr content
    Given the verify stage resolves to the spec "claude:fable" supplied by the project config
    When the verify transition's agent exits non-zero with no session journal entries, whatever its stderr contains
    Then the attribution hint text is identical regardless of the stderr content
    And the stderr tail is surfaced verbatim below the hint

  Scenario: An attributed failure still parks through the existing flow
    Given the apply stage resolves to a spec that explicitly names a model
    When the apply transition's agent exits non-zero with no completion report and no session journal entries
    Then the step surfaces as a blocked, resumable step exactly as an unattributed failure does
    And the engine spawns no retry and substitutes no fallback model
