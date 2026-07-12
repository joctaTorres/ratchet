Feature: Remote byte cursor aligned with the sidecar's surrogateescape arithmetic
  As a batch operator whose agents can emit non-UTF-8 bytes
  I want the remote runtime's tail-poll byte cursor to use the same arithmetic as the sidecar
  So that both channels agree on offsets and never duplicate or skip output

  Scenario: Shared byte-length arithmetic lives once in the deduped runtime module
    Given the deduped command-builder module owns the shared runtime primitives
    When the remote runtime advances its tail-poll offset over a decoded chunk
    Then it computes the byte length with the shared surrogateescape-aware function
    And a lone surrogate in the range U+DC80 to U+DCFF counts as exactly one byte
    And ordinary code points count their standard UTF-8 byte length

  Scenario: Non-UTF-8 bytes fed through the log do not skew the remote cursor
    Given an agent logfile whose content includes non-UTF-8 bytes surfaced as surrogateescape lone surrogates
    And the log arrives across multiple tail polls split inside a line
    When the remote runtime drains the log to completion
    Then every log line is emitted exactly once with no duplicated or skipped output
    And the final offset equals the sidecar's surrogateescape byte count for the same content

  Scenario: Cross-language vectors lock the two cursor implementations together
    Given a shared cursor-vectors file listing text samples with their surrogateescape byte counts
    When the TypeScript contract test and the Python sidecar test each evaluate the vectors
    Then the shared TypeScript function and the sidecar's encode arithmetic report identical byte counts
