Feature: Dead engine branches are removed without changing behavior
  As a maintainer of the batch engine
  I want unreachable branches and legacy seams deleted after their consumers are confirmed dead
  So that readers and reviewers are not misled by scaffold code

  Scenario: llm-judge proof kind is still rejected at manifest load
    Given a batch manifest whose phase proofOfWork kind is "llm-judge"
    When the manifest is parsed
    Then parsing fails with the actionable "not yet supported" error naming integration and blackbox
    And the proof-of-work evaluator handles only the integration and blackbox kinds

  Scenario: the engine accepts only a runtime injection
    Given a test constructs the change-step engine with an injected AgentRuntime
    When the engine runs a change step
    Then the injected runtime receives the spawn request and streams its events
    And the engine deps expose no legacy `spawner` fallback seam

  Scenario: eval keeps its own spawner seam
    Given the eval judge and harnesses inject a `Spawner` directly
    When the legacy engine-deps spawner fallback is removed
    Then the exported `Spawner` type and `realSpawner` remain available to eval
    And the eval suite still passes unchanged
