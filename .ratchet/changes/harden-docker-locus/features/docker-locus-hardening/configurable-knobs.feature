Feature: Docker hardening knobs are batch settings
  As a batch operator
  I want the docker uid, resource limits, and network policy to be ordinary batch settings
  So that I can tune them per project or per manifest through the same cascade as every other setting, with invalid values rejected before any container starts

  # New settings keys: `dockerUser`, `dockerMemory`, `dockerPidsLimit`,
  # `dockerCpus`, and `network` (the issue-#85 vocabulary). They resolve
  # through the standard nearest-wins cascade (default ← project ← manifest)
  # and are threaded to the sidecar as REX_DOCKER_* environment values by
  # `bootstrapRexRuntime`, exactly like `image` → REX_IMAGE. Defaults live in
  # single TS constants (like DEFAULT_DOCKER_IMAGE); the host uid:gid default
  # is computed at bootstrap time, not stored.

  Scenario: Setting a docker knob via batch config persists it
    Given a project with a .ratchet/config.yaml
    When the operator runs batch config --set with "network=none"
    Then the project batch section persists network as "none"
    And the resolved settings report network "none" sourced from the project scope

  Scenario Outline: Invalid knob values are rejected leaving the config unchanged
    Given a project with a .ratchet/config.yaml
    When the operator runs batch config --set with "<key>=<value>"
    Then the command fails with an actionable error naming '<key>'
    And the config file is left unchanged

    Examples:
      | key             | value |
      | dockerPidsLimit | zero  |
      | dockerPidsLimit | -5    |
      | dockerCpus      | many  |
      | dockerMemory    |       |
      | dockerUser      |       |
      | network         |       |

  Scenario: Bootstrap threads the configured knobs to the sidecar for the docker locus
    Given resolved batch settings with locus "docker", dockerUser "0:0", dockerMemory "512m", dockerPidsLimit 128, dockerCpus 1.5, and network "none"
    When the engine bootstraps the ReX runtime
    Then the sidecar launch env carries REX_DOCKER_USER "0:0", REX_DOCKER_MEMORY "512m", REX_DOCKER_PIDS_LIMIT "128", REX_DOCKER_CPUS "1.5", and REX_DOCKER_NETWORK "none"

  Scenario: Bootstrap resolves defaults when no knob is configured
    Given resolved batch settings with locus "docker" and no docker hardening knob configured
    When the engine bootstraps the ReX runtime
    Then the sidecar launch env carries REX_DOCKER_USER as "<host uid>:<host gid>"
    And REX_DOCKER_MEMORY and REX_DOCKER_PIDS_LIMIT carry the documented defaults
    And REX_DOCKER_NETWORK is "bridge"
    And REX_DOCKER_CPUS is not set

  Scenario: The local locus is untouched by docker hardening env
    Given resolved batch settings with locus "local"
    When the engine bootstraps the ReX runtime
    Then no REX_DOCKER_* variable is set in the sidecar launch env
