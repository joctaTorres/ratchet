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
a mandatory (non-optional) documentation task referencing this standard.
