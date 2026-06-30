Feature: file-system marker helpers remainder is proven by unit tests
  As a maintainer holding ratchet to the testing standard
  I want the remaining branches of src/utils/file-system.ts under unit test
  So that marker-block editing and write-permission handling are pinned

  Background:
    Given marker-block string helpers run over in-memory content
    And filesystem-touching cases use an isolated tree under fs.mkdtemp(os.tmpdir())
    And each such test removes its tmp tree in afterEach

  Scenario: removeMarkerBlock removes a block that stands on its own lines
    Given content with a start and end marker each alone on a line
    When removeMarkerBlock runs
    Then the marker block and its lines are removed and triple blank lines collapse

  Scenario: removeMarkerBlock leaves content untouched when markers are missing or inverted
    Given content where the end marker appears before the start marker
    When removeMarkerBlock runs
    Then the original content is returned unchanged

  Scenario: removeMarkerBlock ignores an inline marker mention
    Given content where the marker text appears mid-line with other characters after it
    When removeMarkerBlock runs
    Then that inline mention is not treated as a marker line

  Scenario: removeMarkerBlock preserves the original newline style
    Given content that uses CRLF newlines around the marker block
    When removeMarkerBlock runs
    Then the returned content keeps CRLF line endings

  Scenario: removeMarkerBlock returns empty when removal leaves only whitespace
    Given content that is nothing but the marker block
    When removeMarkerBlock runs
    Then it returns an empty string

  Scenario: a write to a non-writable path is reported as not writable
    Given a target path that cannot be written
    When canWriteFile is queried
    Then it reports the path is not writable rather than throwing
