Feature: One shared agent run-command builder for the rex runtimes
  As a ratchet maintainer
  I want the sidecar and remote rex runtimes to build their agent launch
  command from a single shared builder in spawn-command.ts
  So that the two near-identical constructions cannot drift apart

  Scenario: Sidecar and remote runtimes delegate to one shared builder
    Given the shared spawn-command module exports a single run-command builder
    When the sidecar runtime and the remote runtime each construct an agent launch command
    Then both constructions delegate to that one shared builder
    And neither runtime module contains its own duplicate quoting/env/cat-pipe assembly

  Scenario: The shared builder preserves the sidecar cwd prefix behavior
    Given an AgentSpawnRequest with a command, args, and env
    When the shared builder is invoked with a cwd
    Then the command begins with a single-quoted "cd <cwd>; " prefix
    And is followed by the env exports and the "cat <promptFile> | <argv>" pipeline

  Scenario: The shared builder is behavior-preserving for both runtimes
    Given the AgentSpawnRequest fixtures used by the existing runtime tests
    When buildRunCommand and buildRemoteRunCommand are called after the dedup
    Then each returns a string byte-identical to its pre-dedup output
    And the existing sidecar and remote runtime test suites pass unchanged
