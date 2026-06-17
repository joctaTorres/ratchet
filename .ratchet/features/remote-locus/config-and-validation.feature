Feature: Remote locus configuration and validation
  As an operator
  I want to configure host, port, and auth token for the remote locus
  So that ratchet knows where the swerex-remote server is and how to authenticate

  Scenario: remote is an accepted locus value
    Given the batch locus enum
    When I set locus to "remote" in project config or the manifest
    Then the value is accepted and validates against the locus enum
    And the manifest schema still rejects unknown keys (it stays strict)

  Scenario: remote requires host, port, and auth token
    Given locus is "remote"
    When any of host, port, or authToken is missing
    Then the step fails with a clear, actionable configuration error naming the missing key
    And no REST call is attempted

  Scenario: host, port, and authToken are flat optional settings
    Given the flat settings host, port, and authToken
    When locus is "local" or "docker"
    Then host, port, and authToken are ignored and the loci behave unchanged
    When locus is "remote"
    Then the resolved host, port, and authToken are threaded into the RexRemoteRuntime

  Scenario: an empty host, port, or token is rejected
    Given a project config set command for a remote setting
    When the value provided for host, port, or authToken is empty or non-numeric port
    Then the setting is rejected and the project config file is left unchanged
