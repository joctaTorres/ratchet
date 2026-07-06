Feature: Agent spec whitespace rejection
  As a ratchet user configuring batch agents
  I want an agent[:model] spec with leading or trailing whitespace in either part rejected at parse time
  So that a spec like "claude: opus" fails loudly naming the value instead of shipping "--model  opus" to a spawn

  Scenario Outline: a spec part with leading or trailing whitespace is rejected naming the offending value
    Given the agent spec <spec>
    When parseAgentSpec parses it
    Then it throws an error whose message contains <spec> and identifies the <part> part as having leading or trailing whitespace

    Examples:
      | spec            | part  |
      | "claude: opus"  | model |
      | "claude :m"     | agent |
      | " claude:opus"  | agent |
      | "claude:opus "  | model |
      | "claude: "      | model |

  Scenario Outline: a bare agent name with leading or trailing whitespace is rejected naming the offending value
    Given the bare agent spec <spec> with no colon
    When parseAgentSpec parses it
    Then it throws an error whose message contains <spec> and identifies the agent part as having leading or trailing whitespace

    Examples:
      | spec       |
      | " claude"  |
      | "claude "  |
