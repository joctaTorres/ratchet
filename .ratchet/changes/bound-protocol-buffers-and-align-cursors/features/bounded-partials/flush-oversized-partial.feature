Feature: Bounded partial-line buffers on every streaming channel
  As a batch operator running agents through the ReX runtimes
  I want partial-line buffers capped on all three streaming channels
  So that an agent emitting a huge line with no newline cannot grow memory without bound

  Scenario: Remote runtime flushes an oversized partial as a truncated stdout event
    Given the remote runtime is tail-polling an agent logfile
    And the log delivers more than the 1 MiB partial cap without a newline
    When the runtime appends the chunk to its held partial
    Then the oversized partial is flushed as a stdout event marked as truncated
    And the held partial is reset so memory stays bounded
    And subsequent bytes of the same long line continue streaming as new partials

  Scenario: Sidecar stops pushing back a partial that exceeds the cap
    Given the Python sidecar is tail-polling an agent logfile
    And the trailing partial line exceeds the 1 MiB partial cap
    When the poll iteration processes the chunk
    Then the oversized partial is emitted as a truncated stdout event instead of being pushed back
    And the byte offset advances past the flushed bytes so the next poll does not re-read them

  Scenario: Node protocol buffer is capped instead of growing forever
    Given the sidecar runtime is accumulating protocol-channel bytes into its line buffer
    And the buffer exceeds the 1 MiB partial cap without a newline
    When the next stdout chunk arrives
    Then the oversized buffer is flushed through the protocol line handler marked as truncated
    And the buffer is reset so memory stays bounded
