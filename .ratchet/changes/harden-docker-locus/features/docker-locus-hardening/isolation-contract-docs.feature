Feature: Honest docker isolation contract documentation
  As a batch operator evaluating the docker locus
  I want the reference docs to state exactly what the container does and does not protect
  So that I never mistake the docker locus for a stronger sandbox than it is

  Scenario: agent-runtime.md documents the isolation contract
    Given the docker locus applies uid, memory, pids, cpus, and network constraints
    When a reader opens docs/engine/agent-runtime.md
    Then the docker locus section documents an isolation contract stating the repo mount is writable by design
    And it states the container user, resource limits, and network policy with their defaults and config keys
    And it states what the container does NOT protect (the rw repo mount, and the network under the default bridge policy)

  Scenario: Configuration references enumerate the docker hardening keys
    Given the settings vocabulary gained dockerUser, dockerMemory, dockerPidsLimit, dockerCpus, and network
    When a reader opens docs/configuration/config-yaml.md and docs/commands/batch.md
    Then each new key is listed with its type, default, and docker-locus scope
