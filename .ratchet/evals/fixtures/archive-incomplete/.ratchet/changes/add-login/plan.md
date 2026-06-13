# add-login

## Why

Users currently cannot authenticate, so the account area is unreachable. This
change introduces a login flow so registered users can reach their account.

## What Changes

- Add a login form and a session-issuing endpoint.

## Design

A credential check issues a signed session cookie on success.

## Tasks

- [x] Add the login form
- [ ] Add the session endpoint
