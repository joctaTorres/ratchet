# `Workflow:` help section — group the workflow commands in top-level help

## Why

The top-level `ratchet --help` renders every command in a single, flat
"Commands:" list. The headless loop verbs — `propose`, `apply`, `verify` — plus
the `batch` and `eval` orchestration groups are the day-to-day workflow surface,
but they sit interleaved with setup/utility commands (`init`, `update`, `list`,
`view`, `archive`, `validate`, `doctor`, `status`, `instructions`, `template`,
`new`) with nothing to signal that they form one coherent workflow.

Commander v14 ships first-class **help groups**: `.helpGroup('<heading>')` on a
command assigns it to a named section, and the parent's help renderer prints
each distinct group under its heading. This change uses that mechanism to gather
the five workflow commands under a single `Workflow:` heading — in workflow
order (`propose`, `apply`, `verify`, then `batch`, then `eval`) — while every
other command keeps its existing default placement. The slice is thin: it is a
help-presentation grouping plus one blackbox test, with no behavioural change to
any command.

## What Changes

- **Tag the five workflow commands with a help group.** Call
  `.helpGroup('Workflow:')` on each of the `propose`, `apply`, `verify`,
  `batch`, and `eval` command builders in `src/cli/index.ts`. (Commander
  convention includes the trailing colon in the group label so it renders as a
  heading.) No new commands, options, or actions are added.

- **Ensure ordering within the group reflects workflow order.** Commander lists
  commands in registration order within a group. Confirm the registration order
  yields `propose` → `apply` → `verify` → `batch` → `eval` under the heading; if
  Commander v14 needs the parent's `.commandsGroup(...)` / explicit group
  ordering to place the `Workflow:` section and order its members, apply the
  minimal call(s) needed so the rendered order matches. Do not reorder the
  unrelated commands.

- **Leave unrelated commands untouched.** `init`, `update`, `list`, `view`,
  `archive`, `validate`, `doctor`, `status`, `instructions`, `template`, and
  `new` get no `helpGroup` call and remain in Commander's default command group,
  keeping their current placement in the help output.

- **Blackbox help test.** Add `test/cli/help-groups.test.ts` that imports the
  exported `program` from `src/cli/index.ts`, renders help text via Commander's
  programmatic API (e.g. `program.helpInformation()`), and asserts: (a) the
  output contains a `Workflow:` heading; (b) within the rendered output,
  `propose` precedes `apply` precedes `verify` precedes `batch` precedes `eval`;
  (c) at least one unrelated command (e.g. `init`) is present but NOT under the
  `Workflow:` heading. Prefer asserting on index/order of substrings so the test
  is resilient to surrounding whitespace.

Implements `features/help/workflow-help-section.feature`.

## Tasks

- [x] Add `.helpGroup('Workflow:')` to the `propose`, `apply`, and `verify`
      command builders in `src/cli/index.ts` (the three headless verbs), in
      their existing registration order so they render propose → apply → verify.
- [x] Add `.helpGroup('Workflow:')` to the `batch` and `eval` command builders
      so they join the same group after the verbs (verify → batch → eval).
- [x] If Commander v14 does not place/order the `Workflow:` section as required
      by registration order alone, add the minimal parent-level
      `.commandsGroup(...)` / group-ordering call needed to render the heading
      and the propose → apply → verify → batch → eval order.
      (Not needed: Commander v14 help.js groups by first-appearance order;
      registration order alone yields the required heading and member order.)
- [x] Verify no `helpGroup` is applied to the unrelated commands (`init`,
      `update`, `list`, `view`, `archive`, `validate`, `doctor`, `status`,
      `instructions`, `template`, `new`) so their placement is unchanged.
- [x] Write `test/cli/help-groups.test.ts`: import `program`, render help text,
      and assert the `Workflow:` heading exists, the five commands appear in
      workflow order under it, and an unrelated command (e.g. `init`) is present
      but outside the group.
- [x] Run `pnpm vitest run` and confirm exit 0 — the `Workflow:` heading
      renders for both `ratchet --help` and no-args help, lists
      propose/apply/verify/batch/eval in order, and the existing suites still
      pass.
- [x] **Documentation (mandatory — `documentation` standard, "Reference
      documentation").** Create `docs/commands/workflow-help.md` (the `Workflow:`
      help group: its five members and order — `propose` → `apply` → `verify` →
      `batch` → `eval` — the unrelated commands left in the default group, and the
      `.helpGroup('Workflow:')` mechanism) and update `README.md` with the note
      that `propose`/`apply`/`verify`/`batch`/`eval` render under the `Workflow:`
      heading in `ratchet --help`.
