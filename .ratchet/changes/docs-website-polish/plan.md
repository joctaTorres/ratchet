# docs-website-polish

## Why

Two refinements surfaced in review of the docs-website change. The build is
stricter about broken route links (`onBrokenLinks: 'throw'`) than about broken
relative markdown links (`onBrokenMarkdownLinks: 'warn'`), so a dead in-doc
markdown link could still ship. And the landing page introduces ratchet but does
not show how to install it, forcing visitors to leave the homepage to get
started.

## What Changes

- Set `onBrokenMarkdownLinks: 'throw'` in `website/docusaurus.config.ts` so a
  broken relative markdown link fails the build, matching `onBrokenLinks`.
  Implements `features/docs-website/markdown-link-strictness.feature`.
- Add the install command `npx ratchet-ai@beta init` to the landing page
  (`website/src/pages/index.tsx`) in a monospaced, copy-friendly code block,
  styled with the existing machined theme. Implements
  `features/docs-website/landing-install-command.feature`.
- Update `docs/intro.md` Reference content to note the install command, keeping
  the docs accurate per the documentation standard.

## Design

**Markdown link strictness.** Docusaurus v3 still warns on broken relative
markdown links by default. Setting `onBrokenMarkdownLinks: 'throw'` brings them
to parity with `onBrokenLinks: 'throw'` (already set), so the "ship no broken
links" intent holds for both link classes. This is a one-line config change; the
existing build verification is extended with a broken-markdown-link case.

**Landing install command.** The command is rendered as a static, monospaced
code block in the hero area, below the CTAs, using the existing landing styles
(`index.module.css`). It is kept **agent-neutral**: it uses
`npx ratchet-ai@beta init` with no `--tools` value, because `--tools` is an
optional flag (init prompts interactively without it) and the public landing
page must not special-case a single coding agent. The `@beta` tag matches the
package's current prerelease state as documented in the README. No new
dependency or component is introduced — a styled `<code>`/`<pre>` block within
the existing hero suffices (YAGNI: no copy-to-clipboard widget).

**Standards.** This change follows the `documentation` standard: it updates the
repository-root `docs/intro.md` Reference content for the install command and
keeps it accurate (Task group 3, mandatory and blocking). The
`multi-agent-support` standard is honored in spirit by keeping the install
command agent-neutral, but it is not declared as a tag: this change adds no
per-agent generated skill, command, or adapter — the scope its guidelines govern
— so tagging it would impose checks that do not apply to a landing-page string.

## Tasks

- [x] 1.1 Set `onBrokenMarkdownLinks: 'throw'` in `website/docusaurus.config.ts` (`markdown-link-strictness.feature`)
- [x] 1.2 Verify a broken relative markdown link in a docs page fails the build, then confirm a clean build passes (`markdown-link-strictness.feature`)
- [x] 2.1 Add the `npx ratchet-ai@beta init` install command to the hero in `website/src/pages/index.tsx` as a monospaced code block, below the CTAs (`landing-install-command.feature`)
- [x] 2.2 Style the install command with the machined theme in `website/src/pages/index.module.css` (`landing-install-command.feature`)
- [x] 2.3 Build and confirm the install command renders in the landing output and is agent-neutral (no `--tools`) (`landing-install-command.feature`)
- [x] 3.1 **[documentation standard — mandatory, blocking]** Update `docs/intro.md` to note the install command so the Reference docs stay accurate (`landing-install-command.feature`)
