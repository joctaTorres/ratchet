Feature: Build and Cloudflare Pages deployment
  As a ratchet maintainer
  I want the site to build to static output deployable on Cloudflare Pages
  So that the documentation site updates automatically when main is updated

  Background:
    Given the ratchet repository
    And a Docusaurus app at "website/"

  Scenario: The production build emits static output
    Given the docs seed content exists at "docs/intro.md"
    When the website is built from the "website/" directory
    Then a static site is produced in "website/build"
    And the "/docs/intro" route resolves in the built output

  Scenario: A broken internal link fails the build
    Given the Docusaurus configuration sets "onBrokenLinks" to "throw"
    When the website is built with a broken internal link
    Then the build fails instead of producing a site with the broken link

  Scenario: Cloudflare Pages git integration settings are documented
    Given the website is deployed via Cloudflare Pages git integration
    When "website/README.md" is read
    Then it documents the production branch as "main"
    And it documents the root directory as "website"
    And it documents the build command and the build output directory "website/build"
    And it documents the "NODE_VERSION" build variable
