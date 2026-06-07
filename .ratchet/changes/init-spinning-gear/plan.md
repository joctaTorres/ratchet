# init-spinning-gear

## Why

The `ratchet init` welcome screen animates a gear, but the block-character (`██`)
versions read as coarse and the teeth look pointy at the terminal's low cell
resolution. Rendering the gear with **Braille sub-pixels** (a 2×4 dot grid per
cell, U+2800–28FF) gives ~8× the effective resolution in the same space, so a
smooth, round cogwheel with crisp squared teeth can spin in place. This matches
the prototype in `scripts/braille-demo.mjs`, which is the agreed look.

## What Changes

- Replace the gear generator in `src/ui/ascii-patterns.ts` with a **procedural
  Braille cogwheel**: a geometric gear (square-wave teeth → flat/squared tips,
  hollow bore) rasterized to a dot bitmap, anti-aliased by supersampling, packed
  into Braille glyphs, and rotated **anti-clockwise** one step per frame. Port
  the maths from `scripts/braille-demo.mjs` / `scripts/preview-gear2.mjs`.
- Generate the frames at runtime (once, at module load) from a few tunable
  constants (teeth count, tooth duty/height, dot grid size, frame count) — no
  hand-drawn art, no `logo.txt` dependency in shipped code.
- Size the gear to the welcome column: ~34×32 dots → 17×8 Braille cells (17 chars
  wide), so `ART_COLUMN_WIDTH` and `MIN_WIDTH` in `src/ui/welcome-screen.ts` come
  back **down** (Braille is 1 char/cell, far denser than the 32-char block gear).
- Keep the existing animation loop, static fallback, and Enter-to-continue logic
  in `welcome-screen.ts` (it is a generic frame cycler) — only the frame data and
  the column-width constants change.
- Graceful degrade: when the terminal lacks Unicode support (`supportsUnicode`
  false), emit a small static **ASCII** gear instead of Braille code points. When
  the terminal cannot animate (non-TTY, `NO_COLOR`, too narrow), print a single
  static gear frame (Braille frame 0 where Unicode is available).
- Update `test/ui/ascii-patterns.test.ts` for the new frames; keep the Braille
  preview/demo scripts under `scripts/` for regeneration and font checks.
- Implements `features/init-animation/spinning-gear.feature`.

## Design

**Geometry (squared teeth).** Work in a square dot grid (dots are ~square, so the
gear renders round). A point at radius `r`, angle `θ` is solid when it is in the
ring (`R_HOLLOW ≤ r ≤ R_INNER`) or in a tooth (`R_INNER < r ≤ R_OUTER` **and** the
tooth is present at `θ`). Tooth presence is a **square wave** of `θ` with
`N_TEETH` periods and a duty cycle — a square wave gives each tooth a flat top
(squared), not a taper. The bore (`r < R_HOLLOW`) is empty. The gear is evaluated
analytically per rotation `rot` (subtract `rot` from `θ`), so every frame is a
clean gear with no source-bitmap aliasing.

**Anti-aliasing.** Each dot averages an `SS×SS` grid of sub-samples (≥0.5 on →
dot lit). This keeps tooth edges smooth across rotation instead of shimmering.

**Braille packing.** Every 2×4 block of dots becomes one glyph `0x2800 + bits`,
using the standard Braille dot-bit layout. A `GRID_W×GRID_H` dot bitmap yields
`GRID_W/2 × GRID_H/4` Braille characters per frame.

**Anti-clockwise + seamless loop.** Rotation advances by `DIRECTION·step` with
`DIRECTION = -1` (anti-clockwise; screen y is down). The gear is `N_TEETH`-fold
symmetric, so one tooth pitch (`2π/N_TEETH`) is a full visual revolution. To make
the loop *exactly* seamless, sweep a rotation that is **both** a gear symmetry and
a grid-preserving rotation (a multiple of 90°) — e.g. for `N_TEETH = 8`, sweep 90°
(two pitches) so the final frame maps onto frame 0 on the dot grid with no jump.
The exact pitch/frame-count is settled in implementation and locked by a test
(`gearFrame(0)` deep-equals the wrap-around frame; all frames distinct).

**Sizing & fallback.** `GRID_W×GRID_H ≈ 34×32` dots → 17×8 Braille cells. Set
`ART_COLUMN_WIDTH` to ~20 and re-check `MIN_WIDTH` (art + ~36 cols of welcome
text ≈ 58–60). Uniform row counts across frames keep the cursor-up redraw clean.
Non-Unicode terminals get a small static ASCII gear; non-animating terminals get
a single static frame.

**Why Braille (trade-off).** Braille is the only portable way to get sub-cell
resolution — a glyph cannot be scaled or rotated, and Unicode has no rotated gear
glyphs. The cost is a font dependency: most modern monospace/terminal fonts draw
Braille dots cleanly (it is what `btop`/`drawille`/`plotille` rely on), but a few
render them unevenly, hence the manual font check and the ASCII degrade path.

## Tasks

- [x] 1.1 Port the procedural gear from `scripts/braille-demo.mjs` into
      `src/ui/ascii-patterns.ts`: `solid(x,y,rot)` (square-wave squared teeth +
      hollow bore), supersampled dot rasteriser, and Braille packing
- [x] 1.2 Expose tuning constants (`N_TEETH`, `DUTY`, `TOOTH_H`, dot grid size,
      `FRAME_COUNT`, `DIRECTION`) and generate `WELCOME_ANIMATION.frames` at load
- [x] 1.3 Choose the rotation sweep so the loop is exactly seamless (a 90°-aligned
      whole number of tooth pitches) and set `interval` for a smooth spin
- [x] 2.1 Add the non-Unicode static ASCII gear fallback and confirm no Braille
      code points are emitted when `supportsUnicode` is false
- [x] 2.2 Update `ART_COLUMN_WIDTH` and `MIN_WIDTH` in `src/ui/welcome-screen.ts`
      to fit the ~17-char-wide Braille gear; keep the static-fallback path
- [x] 3.1 Rewrite `test/ui/ascii-patterns.test.ts`: uniform row counts, rows ≤
      `ART_COLUMN_WIDTH`, frames distinct, substantial gear of roughly constant
      mass, and the seamless-loop wrap-around (last→first) holds
- [x] 3.2 Point `scripts/preview-welcome.mjs` at the shipped frames (Braille
      rendering) so preview == shipped output, and keep `braille-demo.mjs` for
      live font checks
- [x] 4.1 Run `pnpm build`, `pnpm test`, `pnpm lint` until green
- [ ] 4.2 Manually run `ratchet init` in a TTY: confirm the gear spins
      anti-clockwise, teeth are squared, the loop has no jump, and it stops on
      Enter; spot-check the non-Unicode and non-TTY fallbacks
