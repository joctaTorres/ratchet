// Render the COMPOSED welcome screen (gear + welcome text) via the non-TTY
// static path, so we see the real side-by-side layout at the new column width —
// not just the gear frames in isolation.
//   NO_COLOR=1 node scripts/preview-compose.mjs
import { showWelcomeScreen } from '../dist/ui/welcome-screen.js';
await showWelcomeScreen(); // non-TTY → canAnimate() false → prints static frame
