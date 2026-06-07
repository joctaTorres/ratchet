/**
 * Standards Library
 *
 * Standards are project-level guideline documents kept at `.ratchet/standards/`.
 * They are a sibling of the features store and the changes directory — NOT a
 * change-graph artifact. Each standard is a free-form markdown file and can cover
 * any concern (testing, security, architecture, design, …).
 *
 * Standards are read by propose (surfaced through `ratchet instructions` so the plan
 * bakes them in) and by verify (read directly to judge the implementation). Apply
 * never reads them: the plan already embedded the applicable standards.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { RATCHET_DIR_NAME } from './config.js';

/**
 * A single standard document from the standards library.
 */
export interface StandardDoc {
  /** Standard name (file name without the .md extension), e.g. "testing". */
  name: string;
  /** File name within the standards directory, e.g. "testing.md". */
  fileName: string;
  /** Raw markdown content of the standard. */
  content: string;
}

/**
 * Resolves the standards directory for a project.
 */
export function getStandardsDir(projectRoot: string): string {
  return path.join(projectRoot, RATCHET_DIR_NAME, 'standards');
}

/**
 * Loads every standard (`*.md`) from a project's standards library.
 *
 * Returns an empty array when the directory is absent or contains no standard
 * files, so callers can treat "no standards" as today's default behavior.
 *
 * @param projectRoot - Project root directory
 * @returns Standards sorted by file name
 */
export function loadStandards(projectRoot: string): StandardDoc[] {
  const dir = getStandardsDir(projectRoot);

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    // Directory missing (or unreadable) — no standards.
    return [];
  }

  return entries
    .filter((fileName) => fileName.toLowerCase().endsWith('.md'))
    .sort()
    .map((fileName) => {
      const fullPath = path.join(dir, fileName);
      let content = '';
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        content = '';
      }
      return {
        name: fileName.replace(/\.md$/i, ''),
        fileName,
        content,
      };
    });
}
