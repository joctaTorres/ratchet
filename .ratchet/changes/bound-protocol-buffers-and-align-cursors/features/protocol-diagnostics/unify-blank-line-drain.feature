Feature: Blank-line emission unified between streaming loop and final drain
  As a batch operator reading a step's streamed transcript
  I want the sidecar's final drain to emit the same lines the streaming loop would
  So that output does not change shape depending on when the poll observed it

  Scenario: Interior blank lines survive the final drain
    Given the sidecar has detected the exit sentinel with undrained log bytes remaining
    And the remaining bytes contain interior blank lines
    When the final drain emits the remaining lines
    Then interior blank lines are emitted as empty stdout events exactly as the streaming loop emits them
    And only the empty segment after a trailing newline is dropped

  Scenario: A trailing partial line is emitted by the final drain
    Given the sidecar has detected the exit sentinel with undrained log bytes remaining
    And the remaining bytes end without a trailing newline
    When the final drain emits the remaining lines
    Then the trailing partial is emitted as a final stdout line
