Feature: version-guard remainder is proven by unit tests
  As a maintainer holding ratchet to the testing standard
  I want the remaining branches of src/core/ci/version-guard.ts under unit test
  So that the publish/skip decision and its registry-failure fail-safe are pinned

  Background:
    Given the published-versions fetcher is injected as a deterministic fake
    And tests that touch GITHUB_OUTPUT use a scratch file under fs.mkdtemp(os.tmpdir())
    And no test spawns npm or reaches the network

  Scenario: a present PUBLISHED_VERSIONS override wins over the registry
    Given a PUBLISHED_VERSIONS env value that is present (even empty)
    When runVersionGuard runs
    Then the decision is computed from the parsed override and the fetcher is never called

  Scenario: an ambiguous registry error fails safe toward SKIP at exit zero
    Given no PUBLISHED_VERSIONS override and a fetcher that returns an error status
    When runVersionGuard runs
    Then the outcome is SKIP with should_publish false, exit code 0, and a fail-safe reason line

  Scenario: a clean registry query feeds the pure decision
    Given a fetcher that returns an ok status with a published set
    When runVersionGuard runs
    Then the decision reflects whether the local version is new

  Scenario: writeShouldPublishOutput appends the verdict when GITHUB_OUTPUT is set
    Given a GITHUB_OUTPUT path pointing at a scratch file
    When writeShouldPublishOutput runs with a true verdict
    Then the file gains a "should_publish=true" line

  Scenario: writeShouldPublishOutput is a no-op when GITHUB_OUTPUT is unset
    Given an environment with no GITHUB_OUTPUT
    When writeShouldPublishOutput runs
    Then nothing is written and no error is raised

  Scenario: a package-not-found (E404) registry failure resolves to the empty set
    Given a registry fetch that fails with an E404-shaped error
    When the default fetcher resolves the published set
    Then it returns an ok status with no versions so the first version publishes

  Scenario: a single published version returned as a bare string is normalized
    Given a registry query that returns a bare version string rather than an array
    When the default fetcher resolves the published set
    Then it returns an ok status carrying that one version
