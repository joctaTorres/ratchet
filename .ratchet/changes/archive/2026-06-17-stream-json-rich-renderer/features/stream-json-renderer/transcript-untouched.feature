Feature: Rendering does not alter the mapped transcript
  In order to keep outcome mapping correct and stable
  As a maintainer
  I want rendering to be a pure display concern that never changes the accumulated transcript the engine maps

  Scenario: The accumulated transcript stays raw regardless of rendering
    Given a stream-json run whose runtime accumulates the raw NDJSON lines into AgentSpawnResult.stdout
    When the renderer renders the same events to the terminal
    Then AgentSpawnResult.stdout still contains the raw, unrendered NDJSON lines
    And mapSessionToOutcome receives exactly the same transcript it would receive without rendering

  Scenario: Rendering failures never corrupt the run result
    Given a renderer that encounters an event it cannot render
    When the renderer falls back to raw output
    Then the AgentSpawnResult exit code and transcript are unaffected by the fallback
