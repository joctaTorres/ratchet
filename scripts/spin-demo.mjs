// Live terminal demo of single-character "spin" options for the welcome screen.
// Run it in your own terminal so you can see the motion:
//     node scripts/spin-demo.mjs
// (A single glyph can't be rotated/scaled; these convey spin by cycling frames.)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sets = [
  ['quadrant pie   ◴◵◶◷', ['◴', '◵', '◶', '◷']],
  ['half circle    ◐◓◑◒', ['◐', '◓', '◑', '◒']],
  ['orbiting block ▖▘▝▗', ['▖', '▘', '▝', '▗']],
  ['braille dots   ⠋⠙⠹…', ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']],
];

const TICKS = 28;
const DELAY = 90;

async function run() {
  process.stdout.write('\nEach option animates for ~2.5s:\n\n');

  for (const [label, frames] of sets) {
    for (let i = 0; i < TICKS; i++) {
      process.stdout.write(`\r   ${frames[i % frames.length]}   ${label}        `);
      await sleep(DELAY);
    }
    process.stdout.write('\n');
  }

  // The literal ⚙ gear (static, since it can't rotate) + a rotating accent.
  const accent = ['◴', '◵', '◶', '◷'];
  for (let i = 0; i < TICKS; i++) {
    process.stdout.write(`\r   ⚙ ${accent[i % accent.length]}   gear glyph + rotating accent   `);
    await sleep(DELAY);
  }
  process.stdout.write('\n');

  // Same accent, as it might appear beside the welcome text.
  for (let i = 0; i < TICKS; i++) {
    process.stdout.write(`\r   ${accent[i % accent.length]} Setting up Ratchet…   `);
    await sleep(DELAY);
  }
  process.stdout.write('\n\nDone.\n');
}

run();
