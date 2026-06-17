Feature: User login
  As a registered user
  I want to sign in
  So that I can access my account

  Scenario: Logging in with valid credentials
    Given a registered user "alice"
    Then she is granted an authenticated session
