export const RATCHET_DIR_NAME = '.ratchet';

/** Single source of truth for the default built-in workflow schema name. */
export const DEFAULT_SCHEMA_NAME = 'ratchet';

export const RATCHET_MARKERS = {
  start: '<!-- RATCHET:START -->',
  end: '<!-- RATCHET:END -->'
};

export interface RatchetConfig {
  aiTools: string[];
}

export interface AIToolOption {
  name: string;
  value: string;
  available: boolean;
  successLabel?: string;
  skillsDir?: string; // e.g., '.claude' - /skills suffix per Agent Skills spec
  detectionPaths?: string[]; // Override skillsDir for auto-detection; any path existing triggers detection
  /**
   * The spawnable coding-agent binary, set ONLY on init tools that are coding
   * agents the batch engine can launch (e.g. 'claude', 'cursor-agent'). This is
   * the single source of truth for "which init tools are coding agents": doctor
   * probes this binary on PATH and the engine spawns it. Tools without it (e.g.
   * github-copilot, opencode) are init configs that are NOT spawnable agents.
   */
  agentBinary?: string;
}

export const AI_TOOLS: AIToolOption[] = [
  { name: 'Claude Code', value: 'claude', available: true, successLabel: 'Claude Code', skillsDir: '.claude', agentBinary: 'claude' },
  { name: 'Codex', value: 'codex', available: true, successLabel: 'Codex', skillsDir: '.codex', agentBinary: 'codex' },
  { name: 'Cursor', value: 'cursor', available: true, successLabel: 'Cursor', skillsDir: '.cursor', agentBinary: 'cursor-agent' },
  { name: 'Gemini', value: 'gemini', available: true, successLabel: 'Gemini', skillsDir: '.gemini', agentBinary: 'gemini' },
  { name: 'GitHub Copilot', value: 'github-copilot', available: true, successLabel: 'GitHub Copilot', skillsDir: '.github', detectionPaths: ['.github/copilot-instructions.md', '.github/instructions', '.github/workflows/copilot-setup-steps.yml', '.github/prompts', '.github/agents', '.github/skills', '.github/.mcp.json'] },
  { name: 'OpenCode', value: 'opencode', available: true, successLabel: 'OpenCode', skillsDir: '.opencode' }
];
