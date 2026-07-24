Feature: Atemporal, self-contained standard authoring
  As a ratchet user authoring a project standard
  I want the propose-standard workflow to insist standards are written atemporally and stand on their own
  So that standards never rot, because they have no lifecycle and are never auto-updated

  Background:
    Given the propose-standard authoring instructions rendered from the shared skill body

  Scenario: Authoring instructions forbid stale-prone citations
    When an author reads the propose-standard instructions
    Then the instructions require standards to be atemporal
    And they forbid citing internal file paths, line numbers, or internal symbol names
    And they forbid describing the current implementation flow ("which part does what today") that goes stale when the flow changes

  Scenario: Authoring instructions require durable framing against stable public surfaces
    When an author reads the propose-standard instructions
    Then the instructions require guidance to be project-specific yet stated durably
    And they direct the author to anchor guidance to stable, public surfaces rather than to implementation internals

  Scenario: Authoring instructions require each standard to stand on its own
    When an author reads the propose-standard instructions
    Then the instructions require each standard to be self-contained
    And they forbid cross-references to other standards, because there is no cascading update or deletion between standards

  Scenario: The rationale for the atemporal rules is stated
    When an author reads the propose-standard instructions
    Then the instructions explain that a standard artifact has no lifecycle and is never automatically updated
    And that this is why its statements and guidance must be atemporal and anti-stale

  Scenario: The atemporal rules reach every supported agent
    Given the supported-tools registry that ratchet init renders skills for
    When the propose-standard skill is generated for each agent with a skills directory
    Then every agent's rendered propose-standard skill contains the atemporal, self-contained authoring rules

  Scenario: The command form carries the same atemporal rules
    Given the rct propose-standard command generated from the same shared body
    When the command content is rendered
    Then it contains the same atemporal, self-contained authoring rules as the skill

  Scenario: The canonical standard template nudges atemporal authoring
    Given the canonical standard template printed by "ratchet template standard"
    When an author fills it in
    Then the template's guidance directs durable, self-contained wording with no file paths, line numbers, or references to other standards

  Scenario: Reference documentation describes the atemporal authoring rules
    Given the repository Reference documentation under docs/
    When a reader looks up how to author a standard
    Then a Reference entry describes the atemporal, self-contained authoring rules and why standards must follow them
