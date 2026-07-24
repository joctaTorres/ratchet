Feature: Gemini as a first-class init tool
  As a ratchet user driving ratchet with Gemini
  I want gemini to be a fully supported init tool
  So that ratchet init wires Gemini like every other coding agent

  Background:
    Given Gemini is registered in AI_TOOLS with skillsDir ".gemini" and agentBinary "gemini"
    And a Gemini ToolCommandAdapter is registered in the command-generation registry

  Scenario: ratchet init --tools gemini generates skills into .gemini
    Given an empty project directory
    When I run "ratchet init --tools gemini"
    Then init completes successfully
    And a skill file exists at ".gemini/skills/ratchet-propose/SKILL.md"

  Scenario: Skill and command generation iterates Gemini like every other agent
    Given the supported-tools registry includes gemini
    When skill and command generation iterates the registry
    Then Gemini receives the same rendered skills and commands as the other agents
    And no shared template logic is special-cased for one agent

  Scenario: Gemini is a checked coding agent in doctor
    Given gemini declares an agentBinary in AI_TOOLS
    When checkAgents enumerates the supported agents
    Then gemini is among the probed agent binaries
