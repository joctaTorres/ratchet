Feature: Docker locus container run constraints
  As a batch operator
  I want the docker locus to run the agent as the host user with resource and network constraints
  So that a containerized agent cannot leave root-owned files on the repo mount, exhaust host resources, or use the network beyond the configured policy

  # `_make_deployment("docker")` in sidecar.py builds the `docker run` argv
  # splice (`docker_args`). Today it passes only the `-v` repo mount; these
  # scenarios harden everything around it. The rw repo mount itself stays by
  # design (the agent must write code and the journal must propagate back).
  # The Node side always threads resolved REX_DOCKER_* values; the sidecar's
  # own defaults are pure unset-fallbacks (same contract as REX_IMAGE).

  Scenario: Container runs as the host uid and gid by default
    Given REX_LOCUS is "docker" and REX_DOCKER_USER is not set
    When the sidecar constructs the docker deployment
    Then docker_args contains "--user" followed by "<host uid>:<host gid>" resolved from the sidecar process
    And files the agent writes onto the bind mount are owned by the host user, not root

  Scenario: Configured user overrides the host uid default
    Given REX_LOCUS is "docker" and REX_DOCKER_USER is "0:0"
    When the sidecar constructs the docker deployment
    Then docker_args contains "--user" followed by "0:0"

  Scenario: Memory and pids limits apply with sane defaults
    Given REX_LOCUS is "docker" and neither REX_DOCKER_MEMORY nor REX_DOCKER_PIDS_LIMIT is set
    When the sidecar constructs the docker deployment
    Then docker_args contains "--memory" followed by the default memory limit
    And docker_args contains "--pids-limit" followed by the default pids limit

  Scenario: Configured memory and pids limits override the defaults
    Given REX_LOCUS is "docker" and REX_DOCKER_MEMORY is "512m" and REX_DOCKER_PIDS_LIMIT is "128"
    When the sidecar constructs the docker deployment
    Then docker_args contains "--memory" followed by "512m"
    And docker_args contains "--pids-limit" followed by "128"

  Scenario: Cpus limit is applied only when configured
    Given REX_LOCUS is "docker" and REX_DOCKER_CPUS is not set
    When the sidecar constructs the docker deployment
    Then docker_args contains no "--cpus" flag
    But when REX_DOCKER_CPUS is "1.5" the deployment is constructed with "--cpus" followed by "1.5"

  Scenario Outline: Network policy is configurable with bridge as the default
    Given REX_LOCUS is "docker" and REX_DOCKER_NETWORK is <configured>
    When the sidecar constructs the docker deployment
    Then docker_args contains "--network" followed by <effective>

    Examples:
      | configured   | effective  |
      | not set      | "bridge"   |
      | "none"       | "none"     |
      | "my-net"     | "my-net"   |

  Scenario: The repo bind mount stays read-write by design
    Given REX_LOCUS is "docker" and REX_MOUNT_HOST names the project root
    When the sidecar constructs the docker deployment
    Then docker_args still contains "-v" followed by "<host>:<container>" with no ":ro" suffix
