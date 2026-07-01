Feature: Documentation site isolation from the CLI package
  As a ratchet maintainer
  I want the documentation site kept separate from the CLI package
  So that the CLI's install, CI gates, and npm publish are never affected by docs dependencies

  Background:
    Given the ratchet repository

  Scenario: The website is not added to the root pnpm workspace
    Given the root "pnpm-workspace.yaml" lists only "." under packages
    When the website package is added at "website/"
    Then "pnpm-workspace.yaml" still lists only "." under packages
    And the website manages its own dependencies with its own lockfile

  Scenario: The root install does not pull in documentation dependencies
    Given the website package exists at "website/"
    When "pnpm install --frozen-lockfile" runs at the repository root
    Then no Docusaurus dependency is installed into the root project
    And the existing CI lint, test, coverage, e2e, and publish steps are unchanged

  Scenario: Build output and dependencies are ignored by git
    Given the website package exists at "website/"
    When the repository ".gitignore" is inspected
    Then "website/build/" is ignored
    And "website/node_modules/" is ignored
