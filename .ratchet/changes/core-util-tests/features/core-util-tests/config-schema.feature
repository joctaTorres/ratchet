Feature: config-schema helpers are proven by unit tests
  As a maintainer holding ratchet to the testing standard
  I want the pure helpers in src/core/config-schema.ts under unit test
  So that key-path validation, nested get/set/delete, value coercion, YAML
    formatting and schema validation can only ratchet upward, never regress

  Background:
    Given the helpers are deterministic functions over in-memory inputs
    And the unit tests touch no filesystem and spawn no process

  Scenario: a valid config passes schema validation
    Given a config object with known fields and unknown passthrough fields
    When validateConfig runs over it
    Then it reports success with no error

  Scenario: an invalid field type fails schema validation with a path-qualified message
    Given a config object whose profile is not one of the allowed enum values
    When validateConfig runs over it
    Then it reports failure with an error naming the offending field path

  Scenario: a known top-level key path is accepted
    Given the key path "delivery"
    When validateConfigKeyPath runs
    Then it returns valid

  Scenario: an unknown top-level key path is rejected
    Given the key path "totallyUnknown"
    When validateConfigKeyPath runs
    Then it returns invalid with a reason naming the unknown key

  Scenario: an empty key path segment is rejected
    Given a key path containing an empty segment
    When validateConfigKeyPath runs
    Then it returns invalid with an empty-path reason

  Scenario: featureFlags accepts one nested level but not two
    Given the key path "featureFlags.someFlag"
    And the key path "featureFlags.a.b"
    When validateConfigKeyPath runs over each
    Then the single-level path is valid and the two-level path is rejected

  Scenario: a non-featureFlags key rejects nested paths
    Given the key path "delivery.nested"
    When validateConfigKeyPath runs
    Then it returns invalid because the key does not support nested keys

  Scenario: getNestedValue resolves and misses by dot path
    Given an object with a nested featureFlags map
    When getNestedValue reads an existing path and a missing path
    Then it returns the stored value for the first and undefined for the second
    And it returns undefined when traversal hits a non-object

  Scenario: setNestedValue writes a deep path creating intermediates
    Given an empty object
    When setNestedValue writes a value at a two-level dot path
    Then the intermediate object is created and the leaf holds the value
    And an existing non-object intermediate is overwritten with an object

  Scenario: deleteNestedValue removes an existing leaf and reports misses
    Given an object with a nested leaf
    When deleteNestedValue removes the leaf
    Then it returns true and the leaf is gone
    And deleting a missing path returns false without mutating the object

  Scenario: coerceValue maps strings to booleans, numbers, or strings
    Given the strings "true", "false", "42", "3.14", "abc", and " "
    When coerceValue runs over each
    Then "true"/"false" become booleans, numeric strings become numbers, and the rest stay strings
    And forceString returns the raw string for any input

  Scenario: formatValueYaml renders scalars, arrays, and nested objects
    Given scalar, empty-array, empty-object, list, and nested-object values
    When formatValueYaml runs over each
    Then scalars and strings render inline, empty collections render as [] and {}
    And lists and nested objects render indented across lines
