Feature: The spec-honesty e2e proof runs the real load and write seams
  As a maintainer trusting the phase proof-of-work
  I want the agent-model-selection integration suite to drive readProjectConfig and setProjectBatchSetting themselves
  So that the proof exercises the honest path instead of a hand-rolled YAML re-parse that can drift from the loader

  Scenario: the load-path proof goes through readProjectConfig itself
    Given a tmpdir project whose .ratchet/config.yaml batch section sets gate "after-propose" and agent "claude:"
    When the integration suite calls readProjectConfig on that project root
    Then the emitted warning names "agent" and "claude:"
    And the returned batch section preserves gate "after-propose" and drops only agent
    And no scenario in the suite re-parses the YAML and calls ProjectConfigSchema.shape.batch.safeParse directly

  Scenario: the write-path proof goes through setProjectBatchSetting itself
    Given a tmpdir project with an existing .ratchet/config.yaml batch section
    When the integration suite calls setProjectBatchSetting with key "agent" and value "claude:"
    Then the result is not ok and its error names "claude:"
    And the config file on disk is byte-for-byte unchanged

  Scenario: pre-fix valid specs keep flowing to the spawned argv unchanged
    Given the existing agent-model-selection scenarios for valid scalar, per-stage, and bare-name specs
    When the suite runs after this change
    Then every pre-existing valid-spec scenario still passes byte-for-byte unchanged
    And the phase proof command `pnpm test test/batch-engine/agent-model-selection.test.ts` exits 0
