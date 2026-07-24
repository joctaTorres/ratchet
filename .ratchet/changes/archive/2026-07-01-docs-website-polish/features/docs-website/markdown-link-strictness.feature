Feature: Broken markdown links fail the build
  As a ratchet maintainer
  I want broken relative markdown links to fail the build, like other broken links
  So that the documentation site never ships a dead in-doc link

  Background:
    Given the ratchet repository
    And a Docusaurus app at "website/"

  Scenario: A broken relative markdown link fails the build
    Given the Docusaurus configuration sets "onBrokenMarkdownLinks" to "throw"
    When the website is built with a broken relative markdown link in a docs page
    Then the build fails instead of producing a site with the broken link

  Scenario: Markdown link strictness matches route link strictness
    When the Docusaurus configuration is inspected
    Then "onBrokenMarkdownLinks" is set to "throw"
    And it has the same strictness as "onBrokenLinks"
