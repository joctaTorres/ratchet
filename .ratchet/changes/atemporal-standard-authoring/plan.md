# Atemporal, self-contained standard authoring

## Why

A standard artifact (`.ratchet/standards/*.md`) has no lifecycle: nothing ever
re-derives or auto-updates it after it is written. When a standard cites internal
file paths, line numbers, symbol names, describes "how the flow works today", or
cross-references another standard, that prose silently rots the moment the code or
a sibling standard changes — and no gate catches it. The `propose-standard`
workflow is where standards are authored, but it does not yet tell the author to
write atemporally. This change bakes the atemporal / anti-stale discipline into
the authoring surface so every future standard is durable by construction.

## What Changes

- Extend the shared `propose-standard` authoring body (`PROPOSE_STANDARD_BODY` in
  `src/core/templates/workflows/propose-standard.ts`) with an explicit
  "Write it atemporally" step that requires standards to be:
  - **atemporal** — no internal file paths, line numbers, internal symbol names,
    or "current flow" walk-throughs that go stale when the implementation moves;
  - **durable but project-specific** — guidance anchored to stable, public
    surfaces rather than implementation internals;
  - **self-contained** — no cross-references to other standards, because there is
    no cascading update or deletion between standards.
  The body also states the rationale: a standard has no lifecycle and is never
  auto-updated, so its statements must be atemporal and anti-stale.
- Add matching bracketed guidance to the canonical standard template
  (`schemas/ratchet/templates/standard.md`) so the structure the author fills in
  nudges durable, self-contained wording. The guidance stays ecosystem-agnostic
  (no toolchain- or path-specific example).
- Add a Reference doc under `docs/standards/` describing the atemporal,
  self-contained authoring rules and why standards must follow them, with an
  overview Mermaid diagram of the authoring flow.
- Extend the unit tests for the propose-standard templates and the cross-agent
  skill-generation test to assert the new rules are present in the skill, the
  command, and every agent's rendered skill.

Because the authoring body is single-source shared content rendered per agent, one
edit propagates to every supported agent — no per-agent copy is hand-authored.

## Design

**Where the guidance lives.** The `propose-standard` skill and the `rct:propose-standard`
command are both rendered from one shared constant, `PROPOSE_STANDARD_BODY`. Editing
that constant is the single seam: it satisfies `multi-agent-support` by construction,
because the same body is rendered into every agent's skills directory from the
supported-tools registry — nothing is tuned for one agent. The new material is added
as a dedicated authoring step (alongside the existing "Write the standard" step),
phrased agent-neutrally ("your agent"/"the author"), so it reads correctly for every
agent.

**Template reinforcement.** The author fills in the canonical template fetched via
`ratchet template standard`. Adding a short bracketed hint to the template's Intent /
Guidelines placeholders puts the atemporal rule at the exact point of authoring. The
hint is generic prose (no package manager, path, or toolchain literal), satisfying
`generalizable-defaults` for content that ships into user repositories.

**Self-containment vs. examples.** The rules must be stated without themselves
violating the discipline they describe: the authoring guidance names *categories* to
avoid (file paths, line numbers, internal symbols, cross-standard references), not any
specific file or standard. The existing test that asserts the skill body does not embed
a literal `> Concern:` copy of the template stays green.

**Multi-agent surface (per `multi-agent-support`).** The change's agent-facing outputs
are the rendered propose-standard skill and command for every agent in the
supported-tools registry. `ratchet init` writes, per agent with a skills directory:
`skills/ratchet-propose-standard/` (skill) and `commands/rct/propose-standard.md`
(command) — for Claude Code, Cursor, Codex, GitHub Copilot, and OpenCode. The
generation test iterates the registry (`AI_TOOLS.filter(t => t.skillsDir)`) rather than
hard-coding one agent, asserting the atemporal rules appear in each.

**Testing (per `testing`).** All new behavior is provable at the unit layer — the
template functions return strings and the generation helper renders per agent over
in-memory inputs, so no filesystem fixture or process spawn is needed. Tests are added
to `test/core/templates/workflows/propose-standard.test.ts` (skill + command content)
and `test/core/shared/skill-generation.test.ts` (per-agent rendering). The full suite
and the 95% coverage gate must stay green.

**Documentation (per `documentation`).** A Reference entry under `docs/standards/`
documents the atemporal / self-contained authoring rules and includes a vertical,
high-contrast Mermaid overview diagram of the authoring flow (every `classDef` sets a
`color:`). `README.md` already introduces `/rct:propose-standard`; the documentation
task reviews it and updates it only if the change makes any described behavior stale.

**Out of scope.** This change does not rewrite existing standards to conform; it only
changes the authoring surface so new and edited standards are guided correctly. The
`delegated-lifecycle` standard governs the apply/batch lifecycle engine and is not
engaged by this content-only authoring change.

## Tasks

- [ ] 1.1 Add the "Write it atemporally" authoring step to `PROPOSE_STANDARD_BODY`
  in `src/core/templates/workflows/propose-standard.ts`: require atemporal wording
  (no internal file paths, line numbers, internal symbol names, or current-flow
  walk-throughs), durable framing against stable public surfaces, self-containment
  (no cross-references to other standards), and state the rationale (a standard has
  no lifecycle / is never auto-updated). Keep the wording agent-neutral.
- [ ] 1.2 Add bracketed atemporal/self-contained guidance to the Intent and
  Guidelines placeholders in `schemas/ratchet/templates/standard.md`, keeping it
  ecosystem-agnostic (no toolchain, path, or command literal).
- [ ] 2.1 Extend `test/core/templates/workflows/propose-standard.test.ts` to assert
  the skill instructions and the command content both contain the atemporal rules
  (atemporal wording, no cross-standard references, no-lifecycle rationale); keep the
  existing "no literal `> Concern:` copy" assertion green.
- [ ] 2.2 Extend `test/core/shared/skill-generation.test.ts` to assert the rendered
  propose-standard skill contains the atemporal rules for every agent in the
  supported-tools registry (iterate `AI_TOOLS.filter(t => t.skillsDir)`, do not
  hard-code one agent).
- [ ] 3.1 **[documentation — required, per the `documentation` standard]** Add a
  Reference doc under `docs/standards/` (e.g. `docs/standards/authoring.md`, wired
  into `docs/standards/_category_.json` ordering) describing the atemporal,
  self-contained authoring rules and why standards must follow them. Include an
  `## Overview` section whose first artifact is a vertical (`flowchart TD`),
  high-contrast Mermaid diagram of the authoring flow, with a `color:` on every
  `classDef` and semantic node symbols. Review `README.md` and update it only if
  this change makes any described `/rct:propose-standard` behavior stale.
- [ ] 4.1 Run the full test suite and the coverage gate; confirm both are green
  (proof of work) before marking the change done.
