---
tag: documentation
---

# Reference documentation

> Concern: documentation

## Intent

Every code change must leave the project's Reference documentation accurate and
complete. Ratchet's machinery — its CLI commands, flags, config keys, generated
artifacts, and public APIs — must be described in version-controlled Reference docs at
the repository-root `docs/` directory so users and agents can look up how the software
works without reading the source. This standard exists to prevent documentation drift:
code and its Reference docs change together, in the same change, or not at all.

Visual documentation is a first-class part of this standard. The core, central, large,
or otherwise important components, flows, and behaviors of the system must be openable
to a reader as a picture, not only as prose: a single accurate Mermaid diagram in an
overview section communicates structure and flow faster than paragraphs can. Diagrams
are held to the same accuracy bar as the prose around them — a stale or broken diagram
is a documentation defect, just like a stale flag description.

## Guidelines

- **Every change that touches code must produce Reference-style documentation under the
  repository-root `docs/` directory.** If the component(s) the change adds or modifies
  have no doc yet, create it; if a doc already exists, update it in the same change.
- **Every plan must include a documentation task, and it is mandatory — never
  optional.** A plan for a code change that omits the documentation task, or marks it
  as optional / "nice to have" / conditional, does not satisfy this standard. The task
  must explicitly point to this standard (the `documentation` tag / this "Reference
  documentation" section) and must enumerate which `docs/` file(s) it creates or
  updates for the components the change touches. It is a required, blocking task on the
  same footing as implementation and tests: the change is not done until it is done.
- **The documentation task must also update the repository `README.md` accordingly.**
  Whenever a change adds, removes, or alters a user-facing surface (a command, flag,
  config key, generated artifact, or any behavior the README describes), the same
  documentation task must update `README.md` to match, in addition to the `docs/`
  Reference entry. The README must never describe behavior the change has made stale.
- **Write Reference docs, not other Diátaxis types.** Reference is
  information-oriented: a technical, accurate description of the machinery — like a
  dictionary or a map. It tells the reader *what is*, not how to learn (Tutorial), how
  to solve a problem (How-to), or why something is the way it is (Explanation). Do not
  smuggle tutorials, opinions, or design rationale into Reference docs; keep them
  austere and factual.
- **Be accurate and complete.** Every code snippet, command, flag, signature, default,
  and config key in a Reference doc must be correct and current. Describe the actual
  behavior of the code as it is in this change — never aspirational behavior. If a
  change alters a flag, signature, default, or output, the corresponding Reference
  entry must be updated to match in the same change.
- **Structure for lookup, not for reading start-to-finish.** Mirror the structure of
  the code/product (e.g. one section per command, per config key, per public function).
  Use consistent headings, ordering, and formatting so readers can scan and find an
  entry quickly. Document the same kinds of things the same way every time.
- **Be consistent with the existing docs.** Match the tone, terminology, and naming
  already used in `docs/` and elsewhere in the project. Use the project's established
  names for concepts; do not introduce synonyms for things that already have a name.
- **Core components, flows, and behaviors MUST have an overview section with a Mermaid
  diagram.** Any component, flow, or behavior that is core, central, main, large, or
  otherwise important to how the system works must be introduced by an `## Overview`
  (or equivalently-named lead) section whose first artifact is a Mermaid diagram that
  shows its structure or flow before the prose details begin. The diagram is mandatory
  for these surfaces, not decorative: a Reference doc for an important component that
  has only prose does not satisfy this standard.
- **Match the diagram type to what is being documented.** Use a flowchart/activity
  diagram for a workflow, process, or business behavior; an architecture graph for a
  set of components and how they connect; a sequence diagram for an interaction or
  request/response exchange between parts; a deployment graph for infrastructure
  topology. One diagram expresses one concept — do not blend a sequence and an
  architecture view into a single chart; add a second diagram instead.
- **Vertical orientation is preferred; horizontal is reserved for small subjects.**
  Overview diagrams for core/large/important subjects MUST be vertical — top-down
  (`flowchart TD` / `graph TB`, or a normal top-to-bottom sequence). Horizontal
  orientation (`flowchart LR` / `graph LR`) MAY be used only for a small flow,
  behavior, or component where a left-to-right reading is clearer; it must not be used
  for the large overview diagrams.
- **Every diagram MUST use high-contrast styling, and every `classDef` MUST set a
  `color:`.** Define node classes with explicit fills and a `color:` text colour on
  every single `classDef` — a class without a `color:` does not satisfy this standard.
  Pair a light fill with dark text and a dark fill with light text so the diagram is
  legible on any background, e.g.:
  ```
  classDef primary  fill:#90EE90,stroke:#333,stroke-width:2px,color:darkgreen
  classDef store    fill:#E6E6FA,stroke:#333,stroke-width:2px,color:darkblue
  classDef error    fill:#FFB6C1,stroke:#DC143C,stroke-width:2px,color:black
  ```
- **Label nodes with semantic Unicode symbols for clarity.** Prefix node labels with a
  symbol that conveys the node's role so the diagram reads at a glance — e.g. 👤 actor,
  🌐 gateway/edge, ⚙️ compute/worker, 💾 database, ⚡ cache, 📨 queue/message, 🔐 auth,
  📝 logging/monitoring, ✅ success, ❌ error. Use them consistently: the same kind of
  thing gets the same symbol across the project's diagrams.
- **A diagram must be valid and accurate, or it does not ship.** Every committed
  diagram must be syntactically valid Mermaid that renders, and must depict the code as
  it exists in this change. Never commit a diagram that fails to parse, and update or
  remove a diagram in the same change that makes it stale — a broken or out-of-date
  diagram is a documentation defect on the same footing as a wrong flag description.
- **Use diagrams deliberately — do not over-document visually.** Visual documentation
  is important, but more diagrams are not better diagrams. Reserve them for the
  core/important subjects above and for genuinely small subjects that a quick horizontal
  chart clarifies; do not add a diagram to a minor, trivial, or leaf component, and do
  not add a chart that merely restates adjacent prose. Prefer one clear, correct
  diagram over several overlapping ones.
- **Write in clear, unambiguous, neutral language.** Reference prose is plain and
  direct: state facts. Avoid first/second-person instruction, marketing language, and
  hedging. Prefer specifics ("`--force` overwrites an existing `.ratchet.yaml`") over
  generalities ("this flag changes behavior").
- **A change is not done until its docs are.** Verification must treat a missing
  documentation task, missing or stale Reference docs for a touched component, or a
  stale `README.md`, the same as a missing test: the change does not satisfy this
  standard until the documentation task exists in the plan and the `docs/` entry and
  `README.md` both exist and match the code.

## Applies to

Every change that touches code in this repository — new or modified CLI commands,
flags, config keys, generated artifacts, public functions/APIs, or any
externally-observable behavior. Each such change must create or update the matching
Reference doc under the repository-root `docs/` directory and update `README.md` where
the change affects a surface it describes, and each plan for such a change must include
a mandatory (non-optional) documentation task referencing this standard. When the
change adds or modifies a core, central, large, or otherwise important component, flow,
or behavior, that documentation task additionally owns the overview Mermaid diagram for
it — created or updated, vertically oriented, high-contrast, and accurate — and the
change is not done until that diagram exists and matches the code.

## Implemented by

<!-- ratchet:implemented-by — generated from .ratchet/features/<capability>/.ratchet.yaml; do not edit by hand -->

- agent-timeout/configurable-timeout.feature
- coverage-gate/documented-floor-80.feature
- coverage-gate/documented-floor-95.feature
- coverage-gate/documented-knob.feature
- coverage-gate/floor-to-80.feature
- coverage-gate/floor-to-95.feature
- coverage-gate/ratchetable-threshold.feature
- docs-website/build-and-deploy.feature
- docs-website/docs-seed.feature
- docs-website/i18n.feature
- docs-website/isolation.feature
- docs-website/landing-install-command.feature
- docs-website/landing-page.feature
- docs-website/markdown-link-strictness.feature
- docs-website/site-structure.feature
- docs-website/workers-assets-deploy.feature
- proof-of-work-boundary/execute-and-record.feature
- proof-of-work-boundary/recorded-proof-reader.feature
- proof-of-work-gate/e2e-gate.feature
- proof-of-work-gate/hard-gate-blocks-on-recorded-proof.feature
- proof-of-work-gate/status-and-selection-agree.feature
- proof-of-work-gate/warn-advances-surfacing-failure.feature
- proof-of-work/exit-zero-prefix.feature
- rerun-recorded-proof/cli-surface.feature
- rerun-recorded-proof/invalidation-folding.feature
