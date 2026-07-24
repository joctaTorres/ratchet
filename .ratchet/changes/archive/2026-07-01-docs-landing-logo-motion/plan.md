# docs-landing-logo-motion

## Why

The landing page hero logo is small and static. Enlarging it and giving it a
slow anti-clockwise rotation makes the page feel alive and draws the eye to the
brand, while keeping with the machined "gear" aesthetic.

## What Changes

- Enlarge the hero logo and add a slow, continuous anti-clockwise rotation in
  `website/src/pages/index.module.css`. Implements
  `features/docs-website/logo-motion.feature`.
- Disable the rotation (and keep the logo visible) under
  `prefers-reduced-motion: reduce`. Implements `logo-motion.feature`.
- Stop applying the shared `.reveal` class to the logo in
  `website/src/pages/index.tsx` so the entrance fade and the spin do not fight
  over the `transform` property.

## Design

The shared `.reveal` page-load animation animates `translateY` (a `transform`),
which would conflict with a rotation also driven through `transform`. To keep
both, the logo carries two independent animations: an opacity-only `rctFadeIn`
for the entrance and a continuous `rctSpin` (`0deg → -360deg`, i.e.
anti-clockwise) at a slow 28s linear cadence. The logo is therefore removed from
the `.reveal` class in the TSX and fades in via its own opacity keyframe. Size is
bumped from 92px to 132px. The existing `prefers-reduced-motion` guard is
extended to set `animation: none` and `opacity: 1` on the logo, so reduced-motion
visitors see a static, visible logo. This is a presentational-only change: no CLI
command, flag, config key, generated artifact, or public API is added or altered.

## Standards

This change follows no project standard. It touches only the landing page's
presentation (logo size and animation) and adds no user-facing CLI surface —
command, flag, config key, generated artifact, or public API — so the
`documentation` standard's Reference-doc requirement has nothing to document, and
the `multi-agent-support` standard is not engaged (no agent-facing or generated
artifact). The `.ratchet.yaml` `standards` field is therefore omitted.

## Tasks

- [x] 1.1 Enlarge the hero logo and add a slow anti-clockwise `rctSpin` animation in `website/src/pages/index.module.css` (`logo-motion.feature`)
- [x] 1.2 Give the logo an opacity-only `rctFadeIn` and remove the `.reveal` class from the logo in `website/src/pages/index.tsx` so fade and spin don't clash (`logo-motion.feature`)
- [x] 1.3 Extend the `prefers-reduced-motion` guard to stop the spin and keep the logo visible (`logo-motion.feature`)
- [x] 2.1 Build the site and confirm the logo's enlarged size and the anti-clockwise spin keyframes are present in the output, with typecheck clean (`logo-motion.feature`)
