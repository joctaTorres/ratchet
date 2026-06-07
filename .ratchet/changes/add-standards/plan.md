# Add standards

## Why

Teams have engineering guidelines — testing, security, architecture, design — that
should shape every change, but ratchet has no place to keep them. Today that
knowledge lives in people's heads or scattered docs, so each proposal re-derives it
and each verification re-argues it. A project-level standards library lets propose
bake the guidelines into the plan and lets verify check the result against them,
consistently and automatically.

## What Changes

- Add a project-level **standards library** at `.ratchet/standards/`, a sibling of
  `.ratchet/features/` and `.ratchet/changes/`. `ratchet init` creates it empty.
- Standards are free-form markdown files (`.ratchet/standards/*.md`); a standard can
  cover any concern (testing, security, architecture, design, …). There is no fixed
  set of names.
- **Propose** and **verify** dynamically load the standards: the CLI reads
  `.ratchet/standards/*.md` and surfaces their content in the `ratchet instructions`
  output (a new `standards` field), alongside the existing `context`/`rules`. Propose
  embeds the applicable standards into the plan; verify checks the implementation
  against them.
- **Apply is intentionally unchanged.** Because propose embeds the standards into
  `plan.md`, apply just follows the plan and never reads the standards directory.
- Add a new **`propose-standard`** workflow — skill + slash command — so users can
  author their own standards. It writes directly to `.ratchet/standards/<name>.md`
  from a standard template, without creating a change.
- Add a `standard.md` template to the `ratchet` schema for authored standards.
- Implements the behavior in
  `features/standards/standards-library.feature`,
  `features/standards/standards-in-workflows.feature`, and
  `features/standards/authoring-standards.feature`.

## Design

**Standards are a library, not a change-graph artifact.** Standards live at the
project level next to the features store, not under `.ratchet/changes/<name>/`. So
this change does **not** add a `standards` entry to the `artifacts:` graph in
`schemas/ratchet/schema.yaml`. The graph stays `features → plan`; standards are an
input that propose/verify *read*, mirroring how the features store is read rather
than generated per change.

**A shared loader, two different surfaces — forced by a shared command.** A small
loader (`src/core/standards.ts`) reads `.ratchet/standards/*.md` and returns each
file's name and content (empty when the directory is absent or empty). How that
content reaches the agent differs by phase because **verify and apply consume the same
CLI command** (`ratchet instructions apply` → `generateApplyInstructions()`), which has
no per-caller distinction. So standards cannot be injected into that shared payload for
verify without also feeding apply.

- **Propose** loads standards via the CLI: `generateInstructions()` (the per-artifact
  path, used only by propose) gains a `standards` field, mirroring how `context` and
  `rules` already flow out (instruction-loader.ts:312–316). Propose's standards are an
  input to *generation*, so they belong in the generation instructions.
- **Verify** loads standards by reading the `.ratchet/standards/` library *directly*
  via prose. Verify already reads the plan and features by absolute path, and those
  paths contain `.../.ratchet/changes/<name>/...`, so the sibling
  `.../.ratchet/standards/` is right there. Verify's standards are an input to
  *judgment*, so reading the library to assess against it is the natural surface.
- **Apply** is untouched. `generateApplyInstructions()` is left exactly as-is and apply
  prose never references standards, so apply's payload *provably* never contains them.

The asymmetry (propose = injected, verify = direct-read) is forced by the shared
apply/verify command and is defensible: different phase, different natural surface.
Everything degrades cleanly: no standards → no `standards` field, nothing to read →
today's exact behavior.

**`propose-standard` is a non-change authoring workflow.** Every existing workflow
operates on a `--change`; authoring a standard does not. The command/skill is invoked
standalone, interviews the user for the standard's name and content, and writes
`.ratchet/standards/<name>.md` (kebab-case) directly from the `standard.md` template —
no `ratchet new change`, no change directory. Registering it touches the workflow
plumbing in several coordinated places (see Tasks): the workflow lists, the
skill/command template tables, the per-tool command adapters, and the
`WORKFLOW_TO_SKILL_DIR` map. It is part of the `core` profile so a default init ships
it.

**The standard template** establishes a light, predictable shape (name, intent, and
the concrete guidelines the standard enforces) while staying free-form enough to cover
any concern. It lives at `schemas/ratchet/templates/standard.md` and is loaded the
same way other schema templates are.

**Upgrade path.** Existing initialized projects won't have `.ratchet/standards/` until
they re-run `ratchet init`; extend mode re-creates the directory list, so a re-init
backfills the folder without touching existing features, changes, or any authored
standards. This is called out so the rollout expectation is explicit.

**Non-goals.** No enforcement engine or schema validation of standard files; standards
are prose the agent reasons over. No standards in the change graph. No changes to
apply's behavior.

## Tasks

- [x] 1.1 Add a standards loader (`src/core/standards.ts`) that reads
      `.ratchet/standards/*.md` and returns `{ name, content }` per file, returning an
      empty result when the directory is missing or empty.
- [x] 1.2 Add `'standards'` to the directory list in `createDirectoryStructure()` for
      both the extend-mode array (init.ts:452–457) and the fresh-mode array
      (init.ts:467–472).
- [x] 1.3 Verify init never overwrites existing standard files (creation is
      idempotent, like the other scaffolded dirs).

- [x] 2.1 Extend `ArtifactInstructions` with an optional `standards` field and populate
      it in `generateInstructions()` for the propose artifacts only (loaded via the
      standards loader). This is the per-artifact path that only propose consumes.
- [x] 2.2 Leave `generateApplyInstructions()` untouched so the shared apply/verify
      payload never carries standards; verify loads `.ratchet/standards/` directly.
- [x] 2.3 Update the propose workflow prose
      (`src/core/templates/workflows/propose.ts`) to read the injected `standards` field
      and embed the applicable ones into the plan and features.
- [x] 2.4 Update the verify workflow prose
      (`src/core/templates/workflows/verify-change.ts`) to read the
      `.ratchet/standards/` library directly (derived from the change paths) and check
      the implementation against the active standards.
- [x] 2.5 Confirm apply prose remains unchanged and makes no reference to standards.

- [x] 3.1 Add a `standard.md` template under `schemas/ratchet/templates/` (name,
      intent, enforced guidelines).
- [x] 3.2 Add the `propose-standard` skill template and command template in
      `skill-templates.ts`, plus a workflow-prose file under
      `src/core/templates/workflows/`.
- [x] 3.3 Register `propose-standard` in the workflow lists `ALL_WORKFLOWS` and
      `CORE_WORKFLOWS` (profiles.ts:14–19).
- [x] 3.4 Add the skill/command entries to `getSkillTemplates`/`getCommandTemplates`
      (skill-generation.ts:45–50 / 65–70) and a `WORKFLOW_TO_SKILL_DIR` entry
      (init.ts:64–69).
- [x] 3.5 Add `getFilePath` handling for the `propose-standard` id in each command
      adapter (claude, codex, cursor, github-copilot, opencode).
- [x] 3.6 Implement the authoring behavior: the skill/command interviews the user and
      writes `.ratchet/standards/<name>.md` (kebab-case) from the template, creating no
      change directory.

- [x] 4.1 Tests: init creates an empty `.ratchet/standards/` (fresh and extend modes)
      and preserves existing standard files on re-init.
- [x] 4.2 Tests: `ratchet instructions` includes `standards` for propose and verify,
      omits it for apply, and omits it entirely when the directory is empty.
- [x] 4.3 Tests: authoring writes a templated file to `.ratchet/standards/` and creates
      no change directory.
- [x] 4.4 Update README/docs to introduce the standards library and the
      `propose-standard` command.
