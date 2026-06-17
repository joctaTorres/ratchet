Feature: Repo-sandboxed-permissive default unblocks ordinary work but denies dangerous ops
  As a ratchet batch operator running unattended
  I want the default posture to skip prompts for ordinary work yet stay confined to the repo
  So that a headless agent gets work done without being able to damage the host or exfiltrate data

  Background:
    Given the default posture "repo-sandboxed-permissive" is in effect
    And no human is available to approve prompts

  Scenario: ordinary in-repo work runs without prompting
    Given the agent wants to edit a file inside the repo
    And the agent wants to run an ordinary build or test command in the repo
    When the agent executes those operations
    Then the operations proceed without an approval prompt

  Scenario: destructive recursive delete outside the repo is denied
    Given the agent attempts "rm -rf" targeting a path outside the project root
    When the policy is applied to the spawned agent
    Then the denylist forbids that operation

  Scenario: privilege escalation is denied
    Given the agent attempts a "sudo" command
    When the policy is applied to the spawned agent
    Then the denylist forbids that operation

  Scenario: writes outside the repo are denied
    Given the agent attempts to write to a path outside the project root
    When the policy is applied to the spawned agent
    Then the denylist forbids that operation

  Scenario: obvious network exfiltration is denied
    Given the agent attempts a "curl ... | sh" piped-to-shell command
    When the policy is applied to the spawned agent
    Then the denylist forbids that operation
