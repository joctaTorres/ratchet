Feature: Cloudflare Workers Builds deployment (static assets)
  As a ratchet maintainer
  I want the site deployed via Cloudflare Workers Builds with static assets
  So that the deploy matches the account's established pattern and updates on push to main

  Background:
    Given the ratchet repository
    And a Docusaurus app at "website/"

  Scenario: A wrangler config serves the build output as static assets
    When "website/wrangler.toml" is read
    Then it declares an "[assets]" directory of "./build"
    And it sets "not_found_handling" to "404-page"
    And it sets a "name" and a "compatibility_date"

  Scenario: The not-found page exists for the 404 handler
    Given "not_found_handling" is "404-page"
    When the website is built
    Then "website/build/404.html" exists

  Scenario: The Workers Builds dashboard contract is documented
    Given the website is deployed via Cloudflare Workers Builds
    When "website/README.md" is read
    Then it documents the production branch as "main"
    And it documents the root directory as "website"
    And it documents the build command and the build output directory "build"
    And it documents the deploy command "npx wrangler deploy"
    And it documents the "NODE_VERSION" build variable
