# init-spinning-gear

## Why

The `ratchet init` welcome screen currently animates the Ratchet logo *building*
from the center and then holding — it plays once and stops moving. A
continuously spinning gear reads as "working/alive," loops naturally while the
user reads the welcome text, and reinforces Ratchet's mechanical gear/ratchet
identity.

## What Changes

- Replace the `WELCOME_ANIMATION` frame set in `src/ui/ascii-patterns.ts` with
  frames depicting a **fully-formed gear that rotates one step per frame** and
  loops seamlessly, instead of the current empty→build-up→hold sequence.
- Keep the existing block/ASCII aesthetic and the Unicode/ASCII fallback
  (`CHARS`) so the gear degrades cleanly on terminals without full Unicode.
- Preserve uniform frame dimensions (same row count across all frames, rows
  within the renderer's fixed art column width) so the cursor-up redraw in
  `welcome-screen.ts` overwrites cleanly with no residue.
- Ensure the non-TTY/no-animation static fallback (`frames[3]` in
  `showWelcomeScreen`) lands on a complete gear.
- No changes to the animation loop, render, or input handling in
  `src/ui/welcome-screen.ts` — the existing modulo loop already cycles frames.
- Add `test/ui/ascii-patterns.test.ts` (none exists today) to lock the frame
  invariants the feature relies on — uniform row count, art-column width fit,
  and ASCII-fallback character safety.
- Implements `features/init-animation/spinning-gear.feature`.

## Design

The animation engine in `welcome-screen.ts` is already a generic frame cycler:
`setInterval` advances `frameIndex = (frameIndex + 1) % frames.length`, redraws
by moving the cursor up `frameHeight` rows, and `frameHeight` is derived from
`frames[0].length`. This means the change is **data-only** — we only swap the
contents of `WELCOME_ANIMATION` and tune `interval`. The loop, render, fallback,
and Enter-to-continue behavior stay untouched.

Gear depiction: the art grid is an 8-cell-wide × 10-row block canvas (each cell
two chars, ≤16 visible chars, comfortably under `ART_COLUMN_WIDTH = 24`). Render
the gear as a solid hub with a hollow center plus a ring of teeth around it. To
spin it, hold the hub fixed and rotate which spokes/teeth are "extended" by one
position each frame. Because the gear has rotational symmetry, a frame count
equal to one tooth-pitch (e.g. 6–8 frames) loops seamlessly: the last frame's
teeth align with the first frame's after one pitch of rotation. Every frame is a
complete gear (different angle), satisfying the "no partial/empty frame"
scenarios — including the static fallback, which can use any frame.

Keep all frames the same row count as today (10 rows) so `frameHeight` math is
unchanged. Tune `interval` (currently 120 ms) for a smooth-but-not-frantic spin;
choose so one full visual revolution takes ~1 second.

Trade-offs: a blocky gear at this small resolution can't show fine teeth, so we
favor a few bold, clearly-offset teeth that read as motion over photorealism.
Frame count is kept modest (6–8) to keep the file readable and the loop seamless.

Testing: the animation has no tests today. The visual spin can't be asserted
without a TTY, but the feature's data invariants can — so we add a unit test
over `WELCOME_ANIMATION` (frame-count > 1, uniform row counts, rows within
`ART_COLUMN_WIDTH`, and ASCII-fallback frames containing only `CHARS` glyphs).
`canAnimate`/`renderFrame` logic stays manual since it depends on terminal
state. These invariants guard against future frame edits silently breaking the
cursor-up redraw.

## Tasks

- [x] 1.1 Design the gear glyph: a fixed hub with hollow center and a ring of
      teeth on the existing 8-cell × 10-row canvas, using `CHARS`
      (full/dim/empty) for the Unicode and ASCII fallback variants
- [x] 1.2 Produce the rotation frames (6–8) by stepping the teeth one position
      per frame so the sequence loops seamlessly back to frame 0
- [x] 1.3 Replace the `frames` array in `WELCOME_ANIMATION`
      (`src/ui/ascii-patterns.ts`) with the gear frames and verify every frame
      has the same row count as `frames[0]` and rows fit within `ART_COLUMN_WIDTH`
- [x] 1.4 Set `WELCOME_ANIMATION.interval` for a smooth spin (~1s per revolution)
      and update the file's header/frame comments to describe a spinning gear
- [x] 2.1 Confirm the static fallback frame (`frames[3]` in
      `showWelcomeScreen`) renders a complete gear; adjust the index/comment if
      a different frame reads better as a still
- [x] 2.2 Add `test/ui/ascii-patterns.test.ts` asserting the frame invariants:
      more than one frame, every frame has the same row count as `frames[0]`,
      every row's visible width fits within `ART_COLUMN_WIDTH` (24), and the
      ASCII-fallback frames contain only the `CHARS` glyphs
- [x] 2.3 Run `pnpm test` and confirm the new test plus `test/core/init.test.ts`
      pass
- [ ] 3.1 Manually run `ratchet init` in a TTY to verify the gear spins
      continuously, loops without flicker or residue, and stops on Enter
- [x] 3.2 Verify non-TTY (piped) and `NO_COLOR` paths print a single complete
      gear
