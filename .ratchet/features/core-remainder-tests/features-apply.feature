Feature: features-apply sidecar remainder is proven by integration tests
  As a maintainer holding ratchet to the testing standard
  I want the remaining branches of src/core/features-apply.ts under integration test
  So that standard-link sidecar reading and writing are pinned over a fixture store

  Background:
    Given each test builds an isolated feature store under fs.mkdtemp(os.tmpdir())
    And each test removes its tmp tree in afterEach so no artifacts remain

  Scenario: a malformed sidecar yaml is read as having no links
    Given a capability sidecar file whose contents are not valid YAML
    When the sidecar is read
    Then it is treated as carrying an empty feature-link map rather than throwing

  Scenario: a sidecar with no remaining links is dropped entirely
    Given a capability whose materialized links have all been removed
    When the sidecar is written
    Then the sidecar file is deleted from the store

  Scenario: non-string link entries are filtered out when reading a sidecar
    Given a sidecar whose feature-link arrays contain non-string entries
    When the sidecar is read
    Then only the string tags are retained

  Scenario: written sidecar link tags are sorted and de-duplicated
    Given a capability sidecar built with duplicate and unordered link tags
    When the sidecar is written
    Then each capability's tags are unique and alphabetically ordered
