Feature: One public one-liner, consistent across surfaces
  As a developer meeting ratchet through npm, the CLI, or the docs
  I want every surface to carry the same retuned one-line description
  So that the product identity does not fork between the website and the tool

  Scenario: The npm package description matches the tagline
    Given the package manifest at package.json
    When the description field is read
    Then it reads "AI-native spec-driven development that only moves forward"

  Scenario: The CLI help description matches the tagline
    Given the built ratchet CLI
    When "ratchet --help" is run
    Then the program description reads "AI-native spec-driven development that only moves forward"

  Scenario: The docs introduction opens with the retuned framing in reference tone
    Given the reference introduction at docs/intro.md
    When the opening paragraph is read
    Then it describes ratchet with the anti-regression framing: specs are executable and re-checked so verified behavior cannot silently regress
    And it contains no marketing language beyond the factual description
    And the old "AI-native system for BDD-flavored" phrasing appears nowhere in docs/intro.md
