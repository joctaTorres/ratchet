Feature: Attributed failure hint and doctor spec-awareness documentation
  As a ratchet user configuring per-stage agent models
  I want the attributed failure hint and doctor's spec-aware probing documented in the README and the docs/ Reference
  So that I can understand an attributed step failure and doctor's probe behavior without reading the source

  Scenario: README documents the attributed model-failure hint
    Given the repository README describes how a batch surfaces step failures
    When a reader looks up what happens when a step fails fast under an explicitly named model
    Then the README states the surfaced failure names the stage, agent, exact model string, and supplying scope (project config vs batch manifest)
    And it states the attribution is a hint ("if this model id is invalid…") above the stderr tail, never a diagnosis
    And it states there is no retry and no fallback model — the existing park/failure flow takes over
    And it states a bare agent name or a failure after journal progress surfaces today's failure unchanged

  Scenario: README documents doctor's spec-aware binary probing
    Given the repository README describes `ratchet doctor`
    When a reader looks up how doctor treats a configured `agent[:model]` value
    Then the README states doctor parses the spec and probes the agent part's binary
    And it states doctor never validates model ids and emits no model-related check

  Scenario: The docs Reference documents the attributed failure surface accurately
    Given the Reference doc "docs/engine/overview.md" describes the outcome mapping
    When the model-failure-attribution phase ships
    Then its failure-mapping entry matches the code: the hint fires only on an explicit model with zero session journal entries, names stage, agent, model string, and supplying scope above the stderr tail, and leaves bare-name, progressed, and scope-less failures byte-for-byte unchanged

  Scenario: The docs Reference documents doctor's spec-aware probing accurately
    Given the Reference doc "docs/commands/doctor.md" describes the agent check
    When the model-failure-attribution phase ships
    Then the agent-check entry matches the code: every configured `agent[:model]` value is parsed through the shared spec parser, the agent part's binary is probed, a missing configured binary fails the check, and no model id is ever validated
