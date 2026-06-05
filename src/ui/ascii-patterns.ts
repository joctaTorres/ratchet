/**
 * ASCII art animation patterns for the welcome screen.
 * Spinning gear animation - a fully-formed gear that rotates one step per
 * frame and loops seamlessly, reinforcing Ratchet's mechanical "ratchet/gear"
 * identity.
 */

// Detect if full Unicode is supported
const supportsUnicode =
  process.platform !== 'win32' ||
  !!process.env.WT_SESSION || // Windows Terminal
  !!process.env.TERM_PROGRAM; // Modern terminal

// Character set based on Unicode support
// Block characters for pixel-art aesthetic
const CHARS = supportsUnicode
  ? { full: '██', dim: '░░', empty: '  ' }
  : { full: '##', dim: '++', empty: '  ' };

const _ = CHARS.empty;
const F = CHARS.full;
const D = CHARS.dim;

/**
 * Build one gear frame.
 *
 * The gear is drawn on an 8-cell-wide × 10-row block canvas (each cell is two
 * chars, so ≤16 visible chars, comfortably under the renderer's
 * ART_COLUMN_WIDTH = 24). It is a fixed body: an octagonal hub with a hollow
 * center, plus a ring of 8 teeth at the compass positions (N, NE, E, SE, S, SW,
 * W, NW). Each tooth sits on the rim — orthogonally adjacent to the hub with
 * empty background on its outward side — so the teeth read as distinct nubs
 * rather than melting into the body. Every tooth is drawn dim except the single
 * "lead" tooth, which is full. Advancing the lead tooth one position per frame
 * makes the gear appear to rotate; because there are 8 tooth positions and 8
 * frames, the sequence loops seamlessly (frame 7 → frame 0) by construction.
 *
 * @param lead - index 0..7 of the highlighted tooth (0 = N, going clockwise)
 */
function gearFrame(lead: number): string[] {
  // Start every cell empty.
  const grid: string[][] = Array.from({ length: 10 }, () =>
    Array.from({ length: 8 }, () => _)
  );

  // --- Gear hub: an octagonal core (rows 3..6, cols 2..5 with the four
  // corner cells trimmed) and a hollow 2×2 center bore. ---
  const hub: Array<[number, number]> = [];
  for (let r = 3; r <= 6; r++) {
    for (let c = 2; c <= 5; c++) {
      hub.push([r, c]);
    }
  }
  // Trim the 4 corners to round the hub into an octagon.
  const corners = new Set(['3,2', '3,5', '6,2', '6,5']);
  for (const [r, c] of hub) {
    if (!corners.has(`${r},${c}`)) grid[r][c] = F;
  }
  // Hollow center (the gear's bore).
  for (let r = 4; r <= 5; r++) {
    for (let c = 3; c <= 4; c++) {
      grid[r][c] = _;
    }
  }

  // Tooth cells keyed by compass index. Each entry is the [row, col] of the
  // tooth cell that sits on the rim: touching the hub, with empty background
  // on the outward side (and never flush inside a solid run).
  // 0:N 1:NE 2:E 3:SE 4:S 5:SW 6:W 7:NW
  const teeth: Array<[number, number]> = [
    [2, 3], // N   above the hub top (row1 above is empty)
    [2, 6], // NE  upper-right diagonal nub
    [4, 6], // E   right of the hub (col7 to the right is empty)
    [7, 6], // SE  lower-right diagonal nub
    [7, 4], // S   below the hub bottom (row8 below is empty)
    [7, 1], // SW  lower-left diagonal nub
    [5, 1], // W   left of the hub (col0 to the left is empty)
    [2, 1], // NW  upper-left diagonal nub
  ];

  // --- Teeth: all dim, except the single lead tooth which is full ---
  for (let i = 0; i < teeth.length; i++) {
    const [r, c] = teeth[i];
    grid[r][c] = i === lead ? F : D;
  }

  return grid.map((row) => row.join(''));
}

/**
 * Welcome animation: a spinning gear.
 *
 * 8 frames, one per tooth position. The gear body (hollow-centered ring) holds
 * still while the highlighted "lead" tooth sweeps clockwise around the 8 teeth,
 * one step per frame, so the last frame flows seamlessly back into the first.
 * Each frame is a complete, recognizable gear at a different rotation.
 *
 * Grid: 8 cells × 2 chars = 16 visible chars wide, 10 rows tall (uniform).
 * interval ≈ 120 ms × 8 frames ≈ 1 s per full revolution.
 */
export const WELCOME_ANIMATION = {
  interval: 120,
  frames: [
    gearFrame(0), // lead tooth at N
    gearFrame(1), // lead tooth at NE
    gearFrame(2), // lead tooth at E
    gearFrame(3), // lead tooth at SE
    gearFrame(4), // lead tooth at S
    gearFrame(5), // lead tooth at SW
    gearFrame(6), // lead tooth at W
    gearFrame(7), // lead tooth at NW
  ],
};
