Feature: Sidecar bootstrap launches with a scoped environment
  As a ratchet operator using the local locus
  I want the ReX sidecar process to launch with only the allowlisted environment
  So that a local-locus agent, which inherits the sidecar's environment, cannot see non-allowlisted host secrets

  Scenario: The sidecar launch env excludes a non-allowlisted host secret
    Given a host environment containing "SUPER_SECRET_TOKEN=hunter2" alongside PATH and HOME
    When the ReX runtime is bootstrapped for the local locus
    Then the resolved launch env does not contain "SUPER_SECRET_TOKEN"
    And the resolved launch env contains HOME with the host value

  Scenario: The venv wiring survives scoping
    Given a ready ReX venv and a host PATH
    When the ReX runtime is bootstrapped for the local locus
    Then the launch env PATH starts with the venv bin directory followed by the host PATH
    And the launch env contains VIRTUAL_ENV pointing at the venv directory

  Scenario: Locus threading vars survive scoping
    Given a bootstrap invocation for the docker locus with an image and mount configured
    When the ReX runtime is bootstrapped
    Then the launch env still carries the REX_LOCUS, REX_WORKDIR, and REX_IMAGE values threaded by the bootstrap

  Scenario: The per-step request env overlays the scoped base in the agent command
    Given an AgentSpawnRequest whose env contains "RATCHET_BATCH_NAME=demo"
    When the sidecar run command is built for that request
    Then the command exports "RATCHET_BATCH_NAME" before invoking the agent
    And the exports contain no variable that is absent from the request env
