Feature: Attributed model-failure integration proof
  As a ratchet user running a batch under an explicitly named model
  I want an integration suite proving the attributed failure surface end to end
  So that a fast argv-level rejection demonstrably surfaces stage, agent, model, and scope

  # Phase proof-of-work for model-failure-attribution:
  #   pnpm test test/batch-engine/model-failure-attribution.test.ts  (exit 0)
  # The suite drives the engine's step entry point over a tmpdir fixture with an
  # injected fake spawn seam exiting non-zero and writing no journal entries —
  # the argv-rejection signature. It asserts on the surfaced step failure only,
  # never on parser or scope-resolution internals already proven at the unit level.

  Scenario: An explicit-model fast failure surfaces attribution above the stderr tail
    Given a transition whose resolved spec explicitly names a model supplied by the project config
    When the spawned agent exits non-zero having written no journal entries during the session
    Then the surfaced step failure names the stage, the agent, the exact model string, and the project-config scope
    And the attribution is phrased as an "if this model id is invalid…" hint above the captured stderr tail
    And the hint never interprets stderr content or diagnoses the failure

  Scenario: The manifest scope is named when the manifest supplied the stage spec
    Given a transition whose stage spec with an explicit model came from the batch manifest
    When the spawned agent exits non-zero having written no journal entries
    Then the surfaced failure's attribution names the batch manifest as the supplying scope

  Scenario: No retry and no fallback model after an attributed failure
    Given a transition whose resolved spec explicitly names a model
    When the spawned agent fails fast with the argv-rejection signature
    Then exactly one spawn occurred with the configured model string on its argv
    And the existing park/failure flow takes over with no retry and no fallback model

  Scenario: A bare-name spec failure surfaces byte-for-byte unchanged
    Given a transition whose resolved spec is a bare agent name with no explicit model
    When the spawned agent exits non-zero having written no journal entries
    Then the surfaced step failure carries no attribution hint and matches today's failure surface

  Scenario: A failure after session journal progress surfaces unchanged
    Given a transition whose resolved spec explicitly names a model
    When the agent writes a journal entry during the session and then exits non-zero
    Then the surfaced step failure carries no attribution hint and matches today's failure surface

  Scenario: The phase proof-of-work suite passes
    Given the model-failure-attribution phase's shipped attribution, scope-resolution, and doctor changes
    When "pnpm test test/batch-engine/model-failure-attribution.test.ts" runs
    Then it exits 0 with every attribution and unchanged-surface scenario green
