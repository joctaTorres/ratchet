---
title: Workflow help group
sidebar_position: 4
---

# `Workflow:` help group

The top-level `ratchet --help` renders the day-to-day workflow commands under a
single `Workflow:` heading, separated from the setup and utility commands. The
grouping is presentation only — it changes no command behavior, options, or
actions.

## Members and order

The following five commands carry `.helpGroup('Workflow:')` and render under the
`Workflow:` heading, in this order:

1. `propose`
2. `apply`
3. `verify`
4. `batch`
5. `eval`

The order reflects registration order, which Commander v14 preserves within a
help group.

## Unrelated commands

Every other command keeps its default placement (the unnamed command group) and
is not listed under `Workflow:`: `init`, `update`, `list`, `view`, `archive`,
`validate`, `doctor`, `status`, `instructions`, `template`, and `new`.

## Mechanism

The grouping uses Commander v14 help groups: `.helpGroup('Workflow:')` on each of
the five command builders assigns it to the named section, and the parent help
renderer prints each distinct group under its heading. The trailing colon is part
of the label, so it renders as a heading. The same heading appears for both
`ratchet --help` and the no-arguments help output.
