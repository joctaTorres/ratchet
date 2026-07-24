Feature: Schema refinement surfaces hygiene messages at both scopes, valid specs unchanged
  As a ratchet user with batch agent settings in project config or a batch manifest
  I want the AgentSettingSchema refinement to surface the parser's new hygiene rejections at both scopes
  So that a malformed spec fails config load naming the offending value, while every previously-valid spec keeps parsing byte-for-byte unchanged

  Scenario Outline: a scalar spec with a hygiene defect fails schema validation at each scope naming the value
    Given a batch agent setting <spec> validated at the <scope> scope
    When the schema validates the setting
    Then validation fails with an issue whose message contains <spec>

    Examples:
      | spec            | scope          |
      | "claude: opus"  | project-config |
      | "claude: opus"  | manifest       |
      | "claude:-flag"  | project-config |
      | "claude:-flag"  | manifest       |

  Scenario: a stage-map entry with a hygiene defect fails schema validation naming the stage and the value
    Given a batch agent stage-map with apply set to "claude :m" validated at the project-config scope
    When the schema validates the setting
    Then validation fails with an issue at path "apply" whose message contains "claude :m"

  Scenario Outline: previously-valid specs and bare names parse unchanged
    Given the agent spec <spec>
    When parseAgentSpec parses it
    Then it parses to agent <agent> and model <model> exactly as before this change

    Examples:
      | spec                    | agent      | model            |
      | "claude"                | "claude"   | (no model key)   |
      | "claude:fable"          | "claude"   | "fable"          |
      | "opencode:zai/glm-5.2"  | "opencode" | "zai/glm-5.2"    |
      | "codex:vendor:tagged-1" | "codex"    | "vendor:tagged-1" |
