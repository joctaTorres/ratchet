Feature: markdown-parser code-fence handling is proven by unit tests
  As a maintainer holding ratchet to the testing standard
  I want the code-fence masking and section logic of
    src/core/parsers/markdown-parser.ts under unit test
  So that headers inside fenced code are never mistaken for sections

  Background:
    Given the parser is constructed over an in-memory markdown string
    And the unit tests touch no filesystem and spawn no process

  Scenario: a hash line inside a fenced code block is not parsed as a header
    Given markdown with a "# heading" line inside a triple-backtick code fence
    When sections are parsed
    Then the fenced hash line is ignored and produces no section

  Scenario: a tilde fence is recognized like a backtick fence
    Given markdown whose code block is delimited by triple tildes
    When sections are parsed
    Then content inside the tilde fence is masked the same way

  Scenario: a closing fence must match the opening marker and be at least as long
    Given a code block opened with four backticks
    When a three-backtick line appears inside it
    Then that shorter line does not close the fence and the block stays open

  Scenario: an unclosed code fence masks the rest of the document
    Given markdown that opens a fence and never closes it
    When sections are parsed
    Then every following line is treated as fenced and yields no further sections

  Scenario: nested headers build a parent-child section tree
    Given markdown with an h1 followed by an h2 and another h1
    When sections are parsed
    Then the h2 is a child of the first h1 and the second h1 is a sibling

  Scenario: CRLF content is normalized before parsing
    Given markdown whose lines end in CRLF
    When sections are parsed
    Then headers are detected as if the content used LF newlines
