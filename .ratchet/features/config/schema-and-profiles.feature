Feature: Schema resolution and profiles
  As a maintainer customizing the workflow
  I want schema resolution precedence and profile-driven setup
  So that projects can override the workflow while defaulting to the built-in schema

  Scenario: The default schema is the built-in ratchet schema
    Given a config that names the "ratchet" schema
    When the schema is resolved
    Then the built-in ratchet schema with artifacts "features" and "plan" is loaded
    And it is used unless an override is provided

  Scenario: Resolution prefers project-local over user over built-in
    Given the same schema name exists project-local, as a user override, and as a built-in
    When the schema is resolved with a project root
    Then the project-local schema definition wins
    And the user override is preferred over the built-in only when no project-local exists

  Scenario: An unknown schema name fails with available options
    Given a config naming a schema that exists nowhere
    When the schema is resolved
    Then an error reports the schema was not found
    And it lists the available schema names

  Scenario: The core profile selects the core workflows
    Given "ratchet init --profile core"
    When init resolves which workflows to install
    Then the core workflow set drives the generated skills and commands
    And a custom profile would instead use the configured custom workflows
