/**
 * Animated welcome screen for the experimental artifact workflow setup.
 * Shows side-by-side layout with animated ASCII art on left and welcome text on right.
 */

import chalk from 'chalk';
import { WELCOME_ANIMATION } from './ascii-patterns.js';

// Width of the ASCII art column (with padding). The Braille gear is 17 chars
// wide (1 char per Braille cell); 20 leaves a small gutter before the text.
export const ART_COLUMN_WIDTH = 20;

// Minimum terminal width for side-by-side layout: art column (20) + ~36 cols of
// welcome text.
const MIN_WIDTH = 58;

/**
 * Welcome text content (right column).
 *
 * Module-private: exercised through the public `showWelcomeScreen` seam (its
 * lines are written to stdout), not imported by tests directly.
 */
function getWelcomeText(): string[] {
  return [
    chalk.white.bold('Welcome to Ratchet'),
    chalk.dim('A lightweight spec-driven framework'),
    '',
    chalk.white('This setup will configure:'),
    chalk.dim('  • Agent Skills for AI tools'),
    chalk.dim('  • /rct:* slash commands'),
    '',
    chalk.white('Quick start after setup:'),
    `  ${chalk.yellow('/rct:propose')} ${chalk.dim('Create a change')}`,
    `  ${chalk.yellow('/rct:apply')}   ${chalk.dim('Implement tasks')}`,
    `  ${chalk.yellow('/rct:archive')} ${chalk.dim('Archive when done')}`,
    '',
    chalk.cyan('Press Enter to select tools...'),
  ];
}

/**
 * Renders a single frame with side-by-side layout.
 *
 * Module-private: exercised through `showWelcomeScreen` (its padded output is
 * what `showWelcomeScreen` writes to stdout).
 */
function renderFrame(artLines: string[], textLines: string[]): string {
  const maxLines = Math.max(artLines.length, textLines.length);
  const lines: string[] = [];

  for (let i = 0; i < maxLines; i++) {
    const artLine = artLines[i] || '';
    const textLine = textLines[i] || '';

    // Pad the art column to fixed width
    const paddedArt = artLine.padEnd(ART_COLUMN_WIDTH);

    // Color the ASCII art with cyan for visual appeal
    const coloredArt = chalk.cyan(paddedArt);

    // Clear line before writing to prevent residual characters
    lines.push(`\x1b[2K${coloredArt}${textLine}`);
  }

  return lines.join('\n');
}

/**
 * Checks if the terminal supports animation.
 *
 * Module-private: its TTY / NO_COLOR / width branches are reached through
 * `showWelcomeScreen` (which gates the animated vs. static path on this result).
 */
function canAnimate(): boolean {
  // Must be TTY
  if (!process.stdout.isTTY) return false;

  // Respect NO_COLOR
  if (process.env.NO_COLOR) return false;

  // Check terminal width
  const columns = process.stdout.columns || 80;
  if (columns < MIN_WIDTH) return false;

  return true;
}

/**
 * Wait for Enter key press.
 *
 * Module-private: its non-TTY and raw-mode keypress branches are reached
 * through `showWelcomeScreen` (which awaits it on the animated path).
 */
function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const { stdin } = process;

    // Handle non-TTY gracefully
    if (!stdin.isTTY) {
      resolve();
      return;
    }

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    const onData = (data: Buffer): void => {
      const char = data.toString();

      // Enter key or Ctrl+C
      if (char === '\r' || char === '\n' || char === '\u0003') {
        stdin.removeListener('data', onData);
        stdin.setRawMode(wasRaw);
        stdin.pause();

        // Handle Ctrl+C
        if (char === '\u0003') {
          process.stdout.write('\n');
          process.exit(0);
        }

        resolve();
      }
    };

    stdin.on('data', onData);
  });
}

/**
 * Shows the welcome screen and resolves once the user presses Enter (or
 * immediately when input is non-interactive).
 *
 * The public seam for the module: it composes the private helpers
 * (`getWelcomeText`/`renderFrame`/`canAnimate`/`waitForEnter`), which are
 * exercised through this function rather than exported. When the terminal
 * supports animation (`canAnimate`) it renders an animated loop and blocks on
 * `waitForEnter`; otherwise it writes a single static frame and returns without
 * blocking. Ctrl+C during the wait exits the process.
 */
export async function showWelcomeScreen(): Promise<void> {
  const textLines = getWelcomeText();

  if (!canAnimate()) {
    // Fallback: show static welcome
    const frame = WELCOME_ANIMATION.frames[0]; // Any frame is a complete gear
    process.stdout.write('\n' + renderFrame(frame, textLines) + '\n\n');
    return;
  }

  let frameIndex = 0;
  let running = true;
  let isFirstRender = true;

  // Content height for cursor movement between frames
  const numContentLines = Math.max(WELCOME_ANIMATION.frames[0].length, textLines.length);
  const frameHeight = numContentLines + 1; // content lines + the blank line after the gear/text

  // Total height including initial newline (for cleanup)
  const totalHeight = frameHeight + 1; // 14

  // Initial render
  process.stdout.write('\n');

  // Animation loop
  const interval = setInterval(() => {
    if (!running) return;

    const frame = WELCOME_ANIMATION.frames[frameIndex];

    // Move cursor up to overwrite previous frame (always after first render)
    if (!isFirstRender) {
      process.stdout.write(`\x1b[${frameHeight}A`);
    }
    isFirstRender = false;

    // Render current frame
    process.stdout.write(renderFrame(frame, textLines) + '\n\n');

    // Advance to next frame
    frameIndex = (frameIndex + 1) % WELCOME_ANIMATION.frames.length;
  }, WELCOME_ANIMATION.interval);

  // Wait for Enter
  await waitForEnter();

  // Stop animation
  running = false;
  clearInterval(interval);

  // Clear the welcome screen and move on
  process.stdout.write(`\x1b[${totalHeight}A`);
  for (let i = 0; i < totalHeight; i++) {
    process.stdout.write('\x1b[2K\n'); // Clear line
  }
  process.stdout.write(`\x1b[${totalHeight}A`); // Move back up
}
