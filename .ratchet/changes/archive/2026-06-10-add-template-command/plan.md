# Add template command

## Why

`propose-standard` hand-copied the standard's structure into its prose, which can
drift from the canonical `schemas/ratchet/templates/standard.md` (adding the `tag`
field had to edit both copies). The other artifacts avoid this: propose reads its
`template` at runtime via `ratchet instructions`, which loads the schema's canonical
file. Standards had no equivalent runtime surface. This adds one so authoring follows
the schema's single source of truth.

> Spec backfill: this change documents behavior that was implemented as a PR-review
> fix (PR #3, branch `feat/standards-library`) before being specced. The code exists
> and the suite is green, so the tasks below are recorded as complete. See the repo's
> prior `chore: backfill specs` for precedent.

## What Changes

- Add a `ratchet template <name>` command that prints a schema's canonical template to
  stdout, backed by the **same `loadTemplate`** the `instructions` command uses.
- Resolution mirrors the rest of the CLI: a project-local schema template wins, with
  the bundled schema template as the fallback. A bare `<name>` resolves a known
  extension (`.md`, then `.feature`); an unknown name errors and exits non-zero.
- `--schema <name>` selects the schema (default: `ratchet`).
- `propose-standard` fetches `ratchet template standard` at runtime and follows it
  instead of embedding the structure, removing the drift hazard.
- Implements `features/cli/template-command.feature`.

## Design

**Reuse, don't invent.** The command is a thin entry point over the existing
`loadTemplate(schema, file, projectRoot)` already used by `ratchet instructions`. No
new resolution pattern: project-local override → user override → bundled, exactly as
`getSchemaDir` already resolves. This keeps standards' authoring contract identical to
how propose/other artifacts get their template at runtime, rather than introducing a
generation-time mechanism.

**Why a command rather than embedding or generation-time injection.** The skill/command
markdown is generated once at `init`; embedding the template (today's state) freezes a
copy that drifts when the schema changes. A runtime command means propose-standard
always follows the current canonical template — the true parallel to propose reading
`ratchet instructions`. The single source of truth becomes
`schemas/ratchet/templates/standard.md`.

**Surface and ergonomics.** `template <name>` takes a bare template name and tries
`<name>.md` then `<name>.feature`, so callers write `ratchet template standard` without
knowing the extension; an explicit `name.ext` is passed through unchanged. Output is the
raw template (trailing newline normalized) so an agent can follow it directly. Errors
surface through the standard CLI error path (message + non-zero exit).

**Non-goals.** No new template *authoring* or validation — this only reads existing
schema templates. No change to how change artifacts (features/plan) fetch their
templates; they continue through `ratchet instructions`.

## Tasks

- [x] 1.1 Add `src/commands/template.ts` with `templateCommand(name, options)`: resolve
      the project root (planning home, falling back to none), load via `loadTemplate`,
      and print the template; try `.md`/`.feature` for a bare name.
- [x] 1.2 Register the `template <name>` command (with `--schema`) in
      `src/cli/index.ts`, wired to the shared CLI error/exit handler.
- [x] 1.3 Point `propose-standard` prose at `ratchet template standard` and remove the
      embedded template block so the schema file is the single source of truth.
- [x] 2.1 Tests: command output is byte-identical to the canonical template; bare-name
      extension resolution; unknown-name error.
- [x] 2.2 Test: propose-standard prose references the command and no longer embeds the
      template structure.
- [x] 2.3 Document `template <name>` in the README commands table.
