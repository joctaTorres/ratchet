---
id: intro
slug: /intro
title: Introduction
sidebar_position: 1
---

# Introduction

ratchet is an AI-native system for BDD-flavored, spec-driven development. A
change is described by executable Gherkin features and an implementation plan,
then implemented against those features and verified before it is archived.

This site renders the reference documentation kept in the repository's `docs/`
directory. Reference entries describe ratchet's machinery — its CLI commands,
flags, configuration keys, generated artifacts, and behavior — so it can be
looked up without reading the source.

## Install

ratchet is published to npm as `ratchet-ai` (the installed command is
`ratchet`). Run it without a global install:

```bash
npx ratchet-ai@beta init
```

`init` configures the project for a coding agent; pass `--tools` to select one
non-interactively, or answer the prompt. ratchet is currently a `beta`
prerelease, so the `@beta` tag is required.

## Where to start

- **Commands** — what each `ratchet` command does and the flags it accepts.
- **Configuration** — the keys ratchet reads and the artifacts it generates.
- **Standards** — the project standards every change must follow.

More reference content is published here as it is added under `docs/`.
