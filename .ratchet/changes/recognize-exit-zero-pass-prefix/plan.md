# recognize-exit-zero-pass-prefix

## Why

`evaluatePassCondition` (`src/core/batch/engine/proof-of-work.ts`) only treats a
pass condition as exit-zero when the *entire* string matches `/^exit[- ]?0$/i`
(`exit 0` / `exit-zero` / `""`). Any other string — including natural prose like
`pass: "exit code 0 — new tests assert the slice works"`, which
`/rct:propose-batch` routinely generates into manifests — silently falls through
to the substring-default branch and searches stdout for that whole sentence
verbatim. It never matches, so the proof **fails closed even though the command
exited 0**. This already broke a real batch's phase gate. The same evaluator
backs the eval judge (`src/core/eval/judge.ts`), so the footgun spans both
surfaces.

## What Changes

- Recognize a **leading** exit-zero directive in a pass condition — `exit 0`,
  `exit-zero`, or `exit code 0` (case-insensitive), optionally followed by
  punctuation/prose such as `— ...`, `:`, `,`, or trailing whitespace — and
  evaluate it as exit-zero semantics (pass iff the command exits 0), instead of
  letting it fall to the substring default.
- Keep `contains:<text>` and `regex:<pattern>` explicit and unchanged.
- Keep the substring default for bare strings that do **not** look like an
  exit-code directive (backward-compatible).
- This fix applies to both the batch proof-of-work gate (`runProofOfWork`) and
  the eval judge (`src/core/eval/judge.ts:245`), since both call the shared
  `evaluatePassCondition`.
- Implements `features/proof-of-work/exit-zero-prefix.feature`.
- Not a breaking change: every previously-recognized condition keeps its
  meaning; only previously-misclassified exit-zero prose changes from
  fail-closed to pass-on-exit-0.

## Design

**Chosen approach — Option A (leading exit-zero prefix recognition).**
Replace the strict full-string exit-zero test with one that matches an
exit-code *directive at the start* of the trimmed condition. Concretely, before
the `contains:` / `regex:` checks, test the trimmed condition against a regex
anchored at the start that accepts `exit`, an optional separator (`-`, space, or
`code `), and `0`, then either end-of-string or a non-alphanumeric boundary
(whitespace or punctuation such as `—`, `:`, `,`). Examples that must match:
`exit 0`, `exit-zero`*, `exit code 0`, `Exit 0, then ...`, `exit-zero: suite
green`, `EXIT CODE 0 — everything passes`. (`exit-zero` is kept as an explicit
recognized alias alongside the numeric forms.) If it matches, return
`exitZeroHandler(exitedZero)`. `contains:` and `regex:` keep their explicit
prefixes. Only conditions that match none of these fall to the unchanged
substring default.

**Alternatives considered and rejected:**
- *Option B — treat any unrecognized condition as exit-zero (fail-open) + warn.*
  Rejected: it silently reinterprets genuine bare-substring conditions (e.g.
  `all checks green`) as exit-zero, changing their meaning and weakening the
  gate. Less predictable than A.
- *Option C — require an explicit `contains:` for all substring matching and
  treat every bare string as exit-zero.* Rejected: it breaks existing bare
  substring conditions that rely on the documented "anything else → substring"
  behavior. A is strictly more backward-compatible: it only reclassifies strings
  that *begin with an exit-code directive*, which no sane author intends as a
  literal stdout substring.

Option A is the least surprising and most backward-compatible: it preserves
`contains:`/`regex:` behavior and existing non-exit-code bare-substring
conditions while fixing the prose case that caused the silent fail-closed.

**Standards embedded in this plan:**
- **`documentation` (mandatory, non-optional).** The pass-condition grammar is a
  user-facing surface documented in two Reference tables: `docs/engine/overview.md`
  (the "Condition string / Passes when" table, ~lines 381–384) and
  `docs/commands/eval.md` (the "Pass conditions for `check.pass`" table,
  ~lines 263–267). Both must be updated to document leading-exit-zero-directive
  recognition (`exit code 0`, and exit-zero prefixes followed by prose), and the
  source-comment grammar block in `proof-of-work.ts` (~lines 80–86) must match.
  `README.md` must be checked and updated if it describes pass conditions. The
  *Mermaid diagram* requirement is **N/A** here: this change modifies one branch
  of an existing evaluator, not a new core component/flow — the affected docs are
  reference tables, and `docs/engine/overview.md` already carries the
  proof-of-work overview diagram, which remains accurate (no flow change). Task
  4.1 below owns this and is blocking.
- **`generalizable-defaults` — N/A.** This is pure evaluator logic. It ships no
  default command, template, or literal into a consuming repository; it only
  changes how an author-supplied condition string is interpreted. No
  ecosystem/toolchain assumption is introduced.
- **`multi-agent-support` — N/A.** No agent-facing generated artifact (no skill,
  command, or template) is added or modified; the evaluator behaves identically
  regardless of which coding agent drives ratchet. No per-agent outputs to
  enumerate.
- **`delegated-lifecycle` — N/A.** This does not touch lifecycle orchestration,
  step selection, the headless verbs, or the shared workflow/skill templates; it
  is a leaf evaluator function.

## Tasks

- [x] 1.1 In `src/core/batch/engine/proof-of-work.ts`, replace the strict
  exit-zero test in `evaluatePassCondition` (line ~118) with a
  leading-exit-zero-directive matcher: accept a trimmed condition that starts
  with `exit` + optional separator (`-`/space/`code `) + `0`, terminated by
  end-of-string or a non-alphanumeric boundary; on match return
  `exitZeroHandler(exitedZero)`. Keep `""`, `exit-zero`, `contains:`, `regex:`,
  and the substring default intact.
- [x] 1.2 Update the grammar doc-comment block above `evaluatePassCondition`
  (~lines 80–86) to describe the leading-directive recognition so the source
  comment matches the new behavior.
- [x] 2.1 In `test/batch-engine/proof-of-work.test.ts`, add `evaluatePassCondition`
  cases proving: `exit code 0 — prose...` passes on exit 0 and is NOT
  substring-matched against stdout; the same prose fails on a non-zero exit with
  reason `nonzero-exit`; `Exit 0, foo`, `exit-zero: bar`, and `EXIT CODE 0 — baz`
  are recognized as exit-zero. Keep the existing `exit 0`, `contains:`, and
  `regex:` cases passing unchanged.
- [x] 2.2 In `test/batch-engine/proof-of-work.test.ts`, add a backward-compat
  case proving a genuinely non-exit-code bare string (e.g. `all checks green`)
  still falls to the substring default: it passes when stdout contains it and
  fails (`pass-condition-unmet`) when stdout lacks it on exit 0.
- [x] 2.3 Check the eval-judge tests (`test/` for `src/core/eval/judge.ts`); add
  a parallel case if judge-level coverage of a leading-exit-zero prose condition
  is absent, since the judge shares `evaluatePassCondition`. If existing
  evaluator-level coverage in 2.1/2.2 is sufficient and no judge-specific path
  differs, note that in the test and skip — do not duplicate without value.
- [x] 3.1 Run the test suite and confirm all proof-of-work and eval-judge tests
  pass with the new behavior.
- [x] 4.1 **[documentation standard — mandatory, blocking]** Update the
  pass-condition grammar in `docs/engine/overview.md` (the "Condition string /
  Passes when" table, ~lines 381–384) and `docs/commands/eval.md` (the "Pass
  conditions for `check.pass`" table, ~lines 263–267) to document that a leading
  `exit 0` / `exit-zero` / `exit code 0` directive (optionally followed by
  punctuation/prose) is recognized as exit-zero, and clarify that the bare-string
  substring default applies only to conditions that are not an exit-code
  directive. Check `README.md` and update it if it describes pass conditions.
  Keep the existing proof-of-work overview diagram in `docs/engine/overview.md`
  (it remains accurate — no flow change). Do not add a new diagram (N/A for this
  change, per Design).
