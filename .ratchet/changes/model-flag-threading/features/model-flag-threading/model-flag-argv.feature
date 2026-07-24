Feature: Adapters emit their own model flag
  As a batch user who named a model in an `agent[:model]` spec
  I want each adapter to append its own model flag to the spawn argv
  So that the spawned agent runs the exact model I named, and a bare agent
  name keeps today's argv byte-for-byte so the harness default model applies

  Scenario Outline: A named model is appended with the adapter's own flag
    Given the "<agent>" built-in adapter
    When buildRequest runs with a request context whose model is "m-1"
    Then the argv is the adapter's base argv followed by "<flag>" and "m-1"

    Examples:
      | agent    | flag    |
      | claude   | --model |
      | opencode | --model |
      | cursor   | --model |
      | codex    | -m      |
      | gemini   | -m      |

  Scenario: No model means byte-for-byte today's argv
    Given every built-in adapter
    When buildRequest runs with a request context that carries no model
    Then each adapter's argv is byte-for-byte identical to the argv before this change

  Scenario: The model flag pair sits between the base argv and the permission flags
    Given the "claude" built-in adapter and a resolved permissions policy
    When buildRequest runs with a request context whose model is "m-1"
    Then the argv is the base argv, then "--model" "m-1", then the permission flags

  Scenario: The registry drift guard covers the model flag
    Given the built-in adapter registry derived from the init tool registry
    When the drift-guard suite inspects every spawnable agent
    Then every adapter declares a non-empty model flag
    And buildRequest with a model appends exactly that flag and the model string
