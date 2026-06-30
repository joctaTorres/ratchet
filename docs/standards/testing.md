---
title: Testing standard
sidebar_position: 1
---

# Testing standard

The `testing` standard (`.ratchet/standards/testing.md`, frontmatter tag
`testing`) defines ratchet's testing strategy: the test pyramid, what to test at
each layer, the minimum line-coverage floor, and the fixture and end-to-end test
patterns. It is loaded by `propose` and `verify` for every change.

## Test pyramid

The suite is weighted toward many fast **unit** tests over pure logic, fewer
**integration** tests over command/core wiring, and a thin **E2E** layer over the
CLI surface. A check is proven at the lowest layer that can prove it; it is not
pushed up the pyramid when a unit test suffices.

## What to test where

| Layer | Subject | Form |
|---|---|---|
| Unit | Pure evaluators, policies, and utilities | Deterministic functions over in-memory inputs; no filesystem or process spawn. |
| Integration | Command verbs (`src/commands/`) and core orchestration (`src/core/`) | Real pieces wired together over a tmpdir fixture repo. |
| E2E | User-visible CLI flows | The built CLI driven end-to-end under `test/cli-e2e/`, asserting on observable output and exit codes. |

## Coverage floor

The coverage bar is a **95% minimum line-coverage floor**, measured by the
project's coverage run over the whole codebase. The enforced `COVERAGE_THRESHOLD`
gate is ratcheted up toward this floor phase by phase: the enforced threshold is
raised as coverage is added and is never lowered. 95% is the target the gate
climbs to.

## Fixture pattern

A test that touches the filesystem builds an isolated repo under
`fs.mkdtemp(os.tmpdir())`, writes only the minimal `.ratchet/` tree it exercises,
and removes it in `afterEach`. Tests do not depend on the real repository, on each
other, or on execution order, and leave no artifacts behind. A test that
implements a Scenario names the corresponding `.feature` in its file header, as
done across `test/core/`.

## End-to-end pattern

End-to-end tests live under `test/cli-e2e/`, drive the compiled CLI end-to-end,
and assert on its observable output and exit codes — never on internal state. They
exist to prove the user-facing surface, not to re-test logic already covered by
unit tests.

## Applies to

Every change that adds or modifies behavior in the repository — pure
evaluators/policies/utilities, command verbs, core orchestration, and
user-visible CLI flows. Each such change adds or updates tests at the correct
pyramid layer, keeps tests isolated via the fixture pattern, and keeps the full
suite and the coverage gate green at or above the enforced `COVERAGE_THRESHOLD`.
