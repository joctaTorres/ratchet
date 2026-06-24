/**
 * Gemini Command Adapter
 *
 * Formats commands for the Gemini CLI. Mirrors the file-based convention used by
 * the other repo-local agents (cursor/opencode): one markdown command file per
 * workflow under the agent's directory, with a `description` frontmatter field.
 */

import path from 'path';
import type { CommandContent, ToolCommandAdapter } from '../types.js';
import { transformToHyphenCommands } from '../../../utils/command-references.js';

/**
 * Gemini adapter for command generation.
 * File path: .gemini/commands/rct-<id>.md
 * Frontmatter: description
 */
export const geminiAdapter: ToolCommandAdapter = {
  toolId: 'gemini',

  getFilePath(commandId: string): string {
    return path.join('.gemini', 'commands', `rct-${commandId}.md`);
  },

  formatFile(content: CommandContent): string {
    // Transform command references from colon to hyphen format for consistency
    // with the other file-based agents.
    const transformedBody = transformToHyphenCommands(content.body);

    return `---
description: ${content.description}
---

${transformedBody}
`;
  },
};
