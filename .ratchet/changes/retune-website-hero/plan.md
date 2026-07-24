# retune-website-hero

## Why

The README now leads with ratchet's trust wedge — verifiable specs that can't silently regress ("only ratchets forward") — but the website hero, the npm/CLI one-liner, and the docs intro still carry the old framing ("AI-native system for BDD-flavored spec-driven development"), which describes the mechanism instead of the differentiator. The public surfaces must tell one story.

## What Changes

- Retune the landing-page hero tagline in `website/docusaurus.config.ts` to the new one-liner (also used as the page meta description via `Layout`).
- Rework the three capability cards in `website/src/pages/index.tsx`: an `// eval` card leads (anti-regression wedge), the `// spec` card absorbs the former `// bdd` card (Gherkin as the contract, two artifacts), and the `// batch` card is reframed as autonomy-with-a-verifier. No `// bdd` card remains.
- Align the one-liner everywhere it is pinned: `package.json` `description` and the `program.description(...)` in `src/cli/index.ts`.
- Update the opening paragraph of `docs/intro.md` to the new framing in neutral Reference tone.
- Update the pinned-copy tests: `test/website/docusaurus-config.test.ts`, `test/website/landing-page.test.ts`, and any other test asserting the old string.

Implements `features/product-messaging/landing-hero.feature` and `features/product-messaging/one-liner.feature`.

## Design

**The copy is decided here, not during apply.** Positioning: lead with the anti-regression wedge shared by both target audiences; never pair autonomy with an unattended-run promise unless the verifier is in the same sentence; keep enterprise vocabulary (auditability, governance, invariants) off the landing page; keep all copy agent-neutral per the `multi-agent-support` standard (the install command stays `npx ratchet-ai@beta init` with no `--tools` value).

- **One-liner** (tagline, `package.json` description, CLI description — identical string):
  `AI-native spec-driven development that only moves forward`
- **Cards** (order matters — eval first):
  1. `// eval` · **Only ratchets forward** — "Every Gherkin scenario doubles as a scored, baseline-diffed eval judged against fixtures — never by the agent grading its own work. Behavior that passes today can't silently regress."
  2. `// spec` · **Behavior is the contract** — "You and your agent agree on behavior as executable Gherkin before code is written. A change is two artifacts — features plus a plan — and Given/When/Then is what the implementation must satisfy."
  3. `// batch` · **Autonomy with a verifier** — "Big objectives ship as ordered vertical-slice phases, driven autonomously — and every phase is gated by an executable proof-of-work, so the loop can't advance by breaking what already worked."
- **`docs/intro.md`** rewords its opening factually (Reference tone, no marketing): ratchet is an AI-native CLI for spec-driven development where behavior is written as executable Gherkin and re-checked by an eval suite, so verified behavior cannot silently regress. No new docs/ entry is needed: no command, flag, config key, or engine behavior changes — this change's documentation surface is `docs/intro.md` itself plus README consistency (the README hero was already retuned in the working tree and ships with this change).
- **Tests** stay at the unit layer (testing standard): the two `test/website/` suites already execute the config module and the landing component with stubs; they are updated to assert the new tagline and cards, not weakened. A repo-wide sweep for the old string ensures no other test or doc pins stale copy. The site itself needs no new test infrastructure.
- The card grid is `repeat(3, 1fr)` in `index.module.css`, so the card count stays at three — merging `// bdd` into `// spec` is what makes room for `// eval` without touching layout.

## Tasks

- [x] 1.1 Set the new tagline in `website/docusaurus.config.ts`
- [x] 1.2 Replace the `FEATURES` cards in `website/src/pages/index.tsx` with the three cards specified in Design (eval → spec → batch), keeping copy agent-neutral and the install command unchanged
- [x] 2.1 Set the same one-liner in `package.json` `description` and `src/cli/index.ts` `program.description(...)`
- [x] 3.1 Update `test/website/docusaurus-config.test.ts` and `test/website/landing-page.test.ts` to assert the new tagline and the `// eval` / `// spec` / `// batch` cards (testing standard: tests updated in the same change, never deleted)
- [x] 3.2 Sweep the repo for remaining occurrences of "AI-native system for BDD-flavored" and update any test, doc, or source still pinning it; run the full suite and coverage gate green (`pnpm test`, coverage ≥ enforced threshold)
- [x] 4.1 Documentation task (documentation standard, mandatory): update the opening of `docs/intro.md` to the retuned framing in Reference tone, and confirm `README.md` already matches the new positioning (retuned in this working tree) — files: `docs/intro.md`, `README.md`
