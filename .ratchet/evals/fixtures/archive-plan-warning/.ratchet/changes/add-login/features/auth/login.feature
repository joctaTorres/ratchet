Feature: User login
  As a registered user
  I want to sign in with my credentials
  So that I can access my account

  Scenario: Logging in with valid credentials
    Given a registered user "alice"
    When she signs in with the correct password
    Then she is granted an authenticated session
