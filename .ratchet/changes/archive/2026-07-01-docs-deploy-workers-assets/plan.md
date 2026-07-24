# docs-deploy-workers-assets

## Why

The docs-website change documented deployment via Cloudflare **Pages** git
integration, but the Cloudflare account this project deploys to uses **Workers
Builds + Static Assets** (Cloudflare is steering new projects there; Pages is in
soft maintenance), as the sibling `joc-thoughts` project already does. Under
Workers Builds a deploy command (`npx wrangler deploy`) is required and needs a
`wrangler.toml` declaring the assets directory — without it, `wrangler deploy`
has nothing to serve. This change adopts the Workers Builds contract.

## What Changes

- Add `website/wrangler.toml` declaring the static-assets contract: an
  `[assets]` directory of `./build` and `not_found_handling = "404-page"`.
  Implements `features/docs-website/workers-assets-deploy.feature`.
- Update `website/README.md` to replace the Cloudflare Pages git-integration
  section with the Workers Builds + Static Assets dashboard contract (root
  directory `website`, build command, output `build`, deploy command
  `npx wrangler deploy`, `NODE_VERSION=22`, production branch `main`).
- Correct the now-stale deploy scenario in the docs-website change's
  `build-and-deploy.feature` so the branch's spec consistently describes Workers
  Builds rather than Pages git integration.

## Design

Mirror the established `joc-thoughts` setup on the same account: a static site
served by Cloudflare Workers' static-assets handler with **no Worker script**.
`website/wrangler.toml` carries a `name`, a `compatibility_date`, and an
`[assets]` block pointing at `./build` (Docusaurus' output; the Astro sibling
uses `./dist`). `not_found_handling = "404-page"` serves `build/404.html` on a
miss — Docusaurus emits that file, so it resolves. Because Cloudflare's build
**root directory** is `website`, `wrangler` runs inside `website/` and resolves
`./build` to `website/build`; the deploy command is `npx wrangler deploy`, run by
the Workers Builds container after the build command. `compatibility_date`
matches the sibling project for consistency.

This is an infrastructure/deploy change, not a content or build-logic change:
the Docusaurus build itself is unchanged, and the site still builds to
`website/build`. The repository's GitHub Actions CI is still not involved in the
docs deploy.

Note (out of scope): the `url` in `docusaurus.config.ts` is still a `pages.dev`
placeholder; it only affects sitemap/canonical URLs and should be set to the
project's real Workers (or custom) domain once known — left for a follow-up so
this change stays focused on the deploy contract.

## Standards

This change follows the `documentation` standard: it updates the
`website/README.md` Reference documentation for the deployment contract and keeps
it accurate to the actual mechanism, and it corrects the stale deploy scenario so
the documented behavior matches reality (Task 2.x, mandatory and blocking). The
`multi-agent-support` standard is not engaged — this is deploy infrastructure
with no agent-facing or generated artifact.

## Tasks

- [x] 1.1 Add `website/wrangler.toml` with `name`, `compatibility_date`, and an `[assets]` block (`directory = "./build"`, `not_found_handling = "404-page"`) (`workers-assets-deploy.feature`)
- [x] 1.2 Build the site and confirm `website/build/404.html` exists so `not_found_handling = "404-page"` resolves (`workers-assets-deploy.feature`)
- [x] 2.1 **[documentation standard — mandatory, blocking]** Replace the Cloudflare Pages section in `website/README.md` with the Workers Builds + Static Assets contract (root `website`, build command, output `build`, deploy `npx wrangler deploy`, `NODE_VERSION=22`, branch `main`) (`workers-assets-deploy.feature`)
- [x] 2.2 **[documentation standard — mandatory, blocking]** Update the stale deploy scenario in the docs-website `build-and-deploy.feature` to describe the Workers Builds contract instead of Pages git integration (`workers-assets-deploy.feature`)
- [x] 2.3 Validate `website/wrangler.toml` with `npx wrangler deploy --dry-run` if the environment permits (no upload); otherwise note it is unvalidated locally (`workers-assets-deploy.feature`)
