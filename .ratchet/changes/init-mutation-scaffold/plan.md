# init-mutation-scaffold

## Why

The `kind: mutation` invariant is fully wired — schema, harness, evaluator fold,
and evidence recording all ship — but `ratchet init` still scaffolds only
`spec-not-weakened`, `tests-still-exist`, and `public-api-unchanged` into
`.ratchet/evals/invariants.yaml`. A project that runs `ratchet init` today never
sees the mutation invariant at all, so turning on real mutation-testing
anti-gaming means hand-authoring an entry from the schema docs instead of
completing one ratchet already put in front of them. This is the last slice of
the mutation-invariant phase: make the default manifest scaffold it, inert, the
same way `tests-still-exist` is scaffolded today.

## What Changes

- `buildDefaultInvariantManifestYaml()` in `src/core/eval/default-manifest.ts`
  gains a fourth block, `mutationScaffoldBlock(detectedDir)`, emitted
  immediately after `tests-still-exist` (they pair — see feature
  `features/eval-invariants/mutation-scaffold.feature`):
  - When `detectTestDirectory` finds a conventional test directory: a live,
    uncommented `id: mutants-are-killed`, `kind: mutation`, `active: false`
    entry with placeholder `test`, `budget`, `threshold` values the user fills
    in and flips active once done.
  - When no test directory is detected: a fully commented-out placeholder
    block (parsed by no one), matching the no-detection branch of
    `testsStillExistBlock`.
- The mutation invariant is never scaffolded active, in either branch — only
  `spec-not-weakened` is ever active in the default manifest, unchanged.
- The placeholder `test` value is a neutral, bracketed instruction (e.g.
  `"<command that runs your test suite>"`), never a real package-manager or
  test-runner literal, per `generalizable-defaults`. `budget`/`threshold` get
  small positive-integer placeholders (numbers carry no ecosystem assumption).
- No new external dependency, no new CLI surface — this only changes the text
  `buildDefaultInvariantManifestYaml` returns.
- Update `docs/eval-invariants.md`'s "Default manifest" section with a fourth
  bullet for the mutation scaffold, and drop the now-stale "Scaffolding a
  `kind: mutation` entry from `ratchet init` remains a follow-on change" note
  in the `kind: mutation` schema section (per `documentation`) — this change
  is that follow-on. `README.md`'s existing invariants paragraph and the
  `.ratchet/evals/invariants.yaml` tree comment already describe the manifest
  generically ("rest scaffolded inert") and need no wording change.

## Design

- **Mirror the existing detect-and-still-inert pattern exactly.** The new
  block is a sibling to `testsStillExistBlock`, not a new mechanism: same
  `detectedDir: string | null` input (the same `detectTestDirectory` call
  already made once in `buildDefaultInvariantManifestYaml`, no second
  detection pass), same live-vs-commented branch shape, same template-string
  composition style (the file is already assembled as a template string
  because it mixes live YAML with commented placeholders — see the module
  docstring — so the new block follows that, not a typed-object serializer).
- **Why gated on the same detection signal as `tests-still-exist`, unlike
  `public-api-unchanged`.** `public-api-unchanged` is always commented because
  no `produce.run` ratchet could pick is generalizable across stacks — there's
  no signal that would ever make it safe to uncomment. The mutation invariant
  is different: a detected test directory is evidence the project already has
  a suite to act as the oracle, so it's worth surfacing the entry live
  (still inert) for the user to complete, exactly as `tests-still-exist` does
  for its own `check.run`. Absent that signal, a commented placeholder avoids
  suggesting mutation testing is one flag away from useful.
- **Placeholders still satisfy the schema.** `MutationInvariantSchema` requires
  non-empty `test`, positive-integer `budget`/`threshold`. Since the entry is
  `active: false`, an unfilled placeholder never runs the harness — it exists
  so the manifest parses cleanly end-to-end (round-trips through
  `loadInvariantManifest` with no error) and so the user edits a working
  skeleton instead of fixing a syntax error first. This is the same trade-off
  `tests-still-exist`'s live branch already makes for `check.run`.
- **`id: mutants-are-killed`** matches the id already used as the worked
  example in `docs/eval-invariants.md`'s `kind: mutation` section, so the
  scaffolded manifest and the docs describe the same entry.
- **No new dependency, no new detection.** This slice touches one pure
  function's output; `detectTestDirectory`, the loader, the evaluator, and the
  harness are all unchanged.
- **`multi-agent-support` compliance.** This slice has no agent-facing
  surface: it adds no skill, command, or template, and the mutation block in
  `.ratchet/evals/invariants.yaml` is written identically regardless of which
  coding agents are selected during `init`. There is no per-agent output to
  enumerate, and no propose/apply/verify skill content changes
  (`delegated-lifecycle` is likewise unaffected).

## Tasks

- [x] 1.1 Add `mutationScaffoldBlock(detectedDir: string | null): string` to
      `src/core/eval/default-manifest.ts`, following `testsStillExistBlock`'s
      shape: live `id: mutants-are-killed` / `kind: mutation` / `active: false`
      entry with placeholder `test`/`budget`/`threshold` when `detectedDir` is
      set, a fully commented block when it is `null`.
- [x] 1.2 Wire `mutationScaffoldBlock` into `buildDefaultInvariantManifestYaml`,
      emitted immediately after `testsStillExistBlock` and reusing the same
      `detectedDir` value (no second `detectTestDirectory` call).
- [x] 1.3 Update the module docstring in `default-manifest.ts` to describe the
      fourth block alongside the existing three.
- [x] 2.1 Extend `test/core/eval/default-manifest.test.ts` with cases mirroring
      the existing `tests-still-exist` coverage for the mutation block: live
      entry when a test directory is detected (kind `mutation`, `active:
      false`, placeholder `test`/positive `budget`/`threshold`), commented
      placeholder and no parsed entry when none is detected, never active in
      either branch, no toolchain literal in the `TOOLCHAIN_LITERALS` sweep,
      and a clean round-trip through `loadInvariantManifest`. Update the file
      header comment to also reference
      `features/eval-invariants/mutation-scaffold.feature` alongside the
      existing `default-manifest.feature`, per `testing`'s
      feature-to-test-header mirroring rule.
- [x] 3.1 Update `docs/eval-invariants.md`: add the mutation-scaffold bullet to
      the "Default manifest" section (mirroring the `tests-still-exist` and
      `public-api-unchanged` bullets) and remove the stale "remains a
      follow-on change" sentence from the `kind: mutation` section, per the
      `documentation` standard. Confirm `README.md` needs no wording change
      (its invariants paragraph and the `.ratchet/evals/invariants.yaml` tree
      comment already describe the manifest generically) and note that check
      in the same task.
- [x] 4.1 Run the phase proof-of-work — `pnpm build && pnpm vitest run
      mutation` — and confirm it exits 0.
