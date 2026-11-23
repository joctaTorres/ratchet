import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getSkillTemplates,
  getCommandContents,
  generateSkillContent,
} from '../../../src/core/shared/skill-generation.js';
import { AI_TOOLS } from '../../../src/core/config.js';
import { CommandAdapterRegistry } from '../../../src/core/command-generation/registry.js';
import { generateCommand } from '../../../src/core/command-generation/generator.js';

/**
 * Rendered-output neutrality: no shipped skill or command body, for any
 * registered agent, instructs the agent to use a bare agent-specific tool name;
 * every agent-specific capability mention uses the capability-plus-fallback
 * form. Also pins the atemporal wording of the multi-agent-support standard.
 *
 * Mirrors:
 * - features/agent-neutral-rendered-output/no-bare-tool-names.feature
 * - features/multi-agent-standard/neutral-wording.feature
 */

/** Known agent-specific tool names the neutrality predicate polices. */
const AGENT_SPECIFIC_TOOLS = ['AskUserQuestion', 'TodoWrite'] as const;

/** Optional-capability qualifier required near every capability mention. */
const QUALIFIER = /if your agent has one/i;
/** Plain-prose fallback required near every capability mention. */
const FALLBACK = /otherwise\b/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split a rendered body into prose windows: blank-line-separated paragraphs
 * with internal newlines collapsed to single spaces, so a line-wrapped
 * sentence reads as one window.
 */
function proseWindows(body: string): string[] {
  return body
    .replace(/\r\n/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/**
 * Neutrality predicate over a rendered skill/command body. Returns a list of
 * violation descriptions; an empty list means the body is agent-neutral.
 *
 * A mention of a known agent-specific tool name is a violation when either:
 *  1. it is a bare instruction — the `**<tool> tool**` / `**<tool>**` form, or
 *     a bare "use <tool>" (optionally "use the <tool> tool") with no capability
 *     framing; or
 *  2. its prose window lacks the optional-capability qualifier ("if your agent
 *     has one") or the plain-prose fallback ("otherwise …") — the pre-fix
 *     propose step-5c shape (qualifier present, fallback absent) fails here.
 *
 * The capability-plus-fallback form ("such as <tool> if your agent has one,
 * otherwise <plain prose>") passes.
 */
function findNeutralityViolations(body: string): string[] {
  const violations: string[] = [];
  const windows = proseWindows(body);
  for (const tool of AGENT_SPECIFIC_TOOLS) {
    const t = escapeRegExp(tool);
    const mention = new RegExp(t);
    const bareBold = new RegExp(`\\*\\*${t}(\\s+tool)?\\*\\*`);
    const bareUse = new RegExp(
      `\\buse\\s+(?:the\\s+)?(?:\\*\\*)?${t}(?:\\s+tool)?(?:\\*\\*)?`,
      'i',
    );
    for (const window of windows) {
      if (!mention.test(window)) continue;
      if (bareBold.test(window)) {
        violations.push(`bare "**${tool}**" instruction in: ${window}`);
        continue;
      }
      if (bareUse.test(window)) {
        violations.push(`bare "use ${tool}" instruction in: ${window}`);
        continue;
      }
      if (!QUALIFIER.test(window) || !FALLBACK.test(window)) {
        violations.push(
          `${tool} mention missing the capability qualifier or the plain-prose fallback in: ${window}`,
        );
      }
    }
  }
  return violations;
}

describe('agent-neutral rendered output', () => {
  describe('the neutrality predicate', () => {
    it('rejects the bare "**<tool> tool**" instruction form', () => {
      const body =
        'Run `ratchet list --json` to get available changes. Use the **AskUserQuestion tool** to let the user select.';
      expect(findNeutralityViolations(body)).not.toEqual([]);
    });

    it('rejects a bare "use <tool>" instruction', () => {
      const body = 'Use TodoWrite to track progress through the artifacts.';
      expect(findNeutralityViolations(body)).not.toEqual([]);
    });

    it('rejects a capability mention missing the plain-prose fallback', () => {
      // The pre-fix propose step-5c shape: the optional-capability qualifier is
      // present but the "otherwise …" fallback is absent.
      const body =
        '- Ask the user to clarify (use a structured-question tool such as AskUserQuestion if your agent has one)\n- Then continue with creation';
      expect(findNeutralityViolations(body)).not.toEqual([]);
    });

    it('rejects a capability mention missing the optional-capability qualifier', () => {
      const body =
        'Ask the user to clarify — use a structured-question tool such as AskUserQuestion, otherwise ask in plain prose.';
      expect(findNeutralityViolations(body)).not.toEqual([]);
    });

    it('accepts the capability-plus-fallback form', () => {
      const body =
        'Let the user select — use a structured-question capability such as AskUserQuestion if your agent has one, otherwise ask in plain prose.';
      expect(findNeutralityViolations(body)).toEqual([]);
    });

    it('accepts a body with no agent-specific tool mentions', () => {
      const body = 'Run `ratchet status --json` and parse the output.';
      expect(findNeutralityViolations(body)).toEqual([]);
    });
  });

  describe('render loop over the supported-tools registry', () => {
    it('renders every skill template for every registered agent with no bare agent-specific tool name', () => {
      const agents = AI_TOOLS.filter((t) => t.skillsDir);
      const skillTemplates = getSkillTemplates();
      // The checked set must be non-empty and cover every registered agent: a
      // registry entry silently skipped by this loop fails here.
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.length).toBe(AI_TOOLS.length);
      expect(skillTemplates.length).toBeGreaterThan(0);

      for (const tool of agents) {
        for (const { template, dirName } of skillTemplates) {
          const content = generateSkillContent(template, '0.0.0-test');
          expect(
            findNeutralityViolations(content),
            `skill ${dirName} rendered for agent ${tool.value}`,
          ).toEqual([]);
        }
      }
    });

    it('renders every command template through every registered adapter with no bare agent-specific tool name', () => {
      const adapters = CommandAdapterRegistry.getAll();
      const commandContents = getCommandContents();
      // Non-empty checked set covering every registered agent, as above.
      expect(adapters.length).toBeGreaterThan(0);
      expect(adapters.length).toBe(AI_TOOLS.length);
      expect(commandContents.length).toBeGreaterThan(0);

      for (const adapter of adapters) {
        for (const content of commandContents) {
          const { fileContent } = generateCommand(content, adapter);
          expect(
            findNeutralityViolations(fileContent),
            `command ${content.id} rendered for agent ${adapter.toolId}`,
          ).toEqual([]);
        }
      }
    });
  });

  // Mirrors features/agent-workflows/explore-template-retired.feature
  //   - Scenario: The generated agent surface contains no explore skill or command
  describe('no explore skill or command for any registered agent', () => {
    it('generates no ratchet-explore skill directory for any agent', () => {
      const agents = AI_TOOLS.filter((t) => t.skillsDir);
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.length).toBe(AI_TOOLS.length);

      const dirNames = getSkillTemplates().map(({ dirName }) => dirName);
      for (const tool of agents) {
        expect(
          dirNames,
          `skill directories for agent ${tool.value} (${tool.skillsDir}/skills/)`,
        ).not.toContain('ratchet-explore');
      }
    });

    it('generates no explore command file through any agent adapter', () => {
      const adapters = CommandAdapterRegistry.getAll();
      expect(adapters.length).toBeGreaterThan(0);
      expect(adapters.length).toBe(AI_TOOLS.length);

      const commandContents = getCommandContents();
      expect(commandContents.map(({ id }) => id)).not.toContain('explore');

      for (const adapter of adapters) {
        for (const content of commandContents) {
          const { path: filePath } = generateCommand(content, adapter);
          expect(
            content.id,
            `command rendered for agent ${adapter.toolId}`,
          ).not.toBe('explore');
          expect(
            filePath,
            `command path for agent ${adapter.toolId}`,
          ).not.toMatch(/explore/);
        }
      }
    });
  });

  describe('known bare-tool violations stay fixed', () => {
    const cases = [
      { workflow: 'apply', tool: 'AskUserQuestion' },
      { workflow: 'archive', tool: 'AskUserQuestion' },
      { workflow: 'propose', tool: 'TodoWrite' },
    ] as const;

    for (const { workflow, tool } of cases) {
      it(`the ${workflow} workflow does not instruct the bare tool "${tool}"`, () => {
        const bodies = [
          ...getSkillTemplates([workflow]).map(({ template }) =>
            generateSkillContent(template, '0.0.0-test'),
          ),
          ...getCommandContents([workflow]).map((c) => c.body),
        ];
        expect(bodies.length).toBeGreaterThan(0);
        const bareBold = new RegExp(`\\*\\*${escapeRegExp(tool)}(\\s+tool)?\\*\\*`);
        for (const body of bodies) {
          expect(body, `${workflow} body`).not.toMatch(bareBold);
          expect(findNeutralityViolations(body), `${workflow} body`).toEqual([]);
        }
      });
    }
  });

  it("propose's structured-question mentions all carry a plain-prose fallback", () => {
    const bodies = [
      ...getSkillTemplates(['propose']).map(({ template }) =>
        generateSkillContent(template, '0.0.0-test'),
      ),
      ...getCommandContents(['propose']).map((c) => c.body),
    ];
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      for (const window of proseWindows(body)) {
        if (!/AskUserQuestion/.test(window)) continue;
        expect(window).toMatch(QUALIFIER);
        expect(window).toMatch(FALLBACK);
      }
    }
  });
});

describe('the multi-agent-support standard wording', () => {
  // The subject of these assertions is the shipped standard file itself, so
  // this block intentionally reads the real repository file rather than a
  // tmpdir fixture.
  const standardPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../.ratchet/standards/multi-agent-support.md',
  );
  const body = readFileSync(standardPath, 'utf-8');
  // Whitespace-normalized form for phrase assertions across line wraps.
  const flat = body.replace(/\s+/g, ' ');

  it('names no individual coding agent', () => {
    const agentNames = [
      'Claude Code',
      'Claude',
      'Cursor',
      'Codex',
      'Gemini',
      'GitHub Copilot',
      'Copilot',
      'OpenCode',
    ];
    for (const agent of agentNames) {
      expect(body).not.toMatch(new RegExp(`\\b${escapeRegExp(agent)}\\b`));
    }
  });

  it('refers to the supported agents only as the supported-tools registry', () => {
    expect(body).toMatch(/supported-tools registry/);
  });

  it('cites no internal repository source path', () => {
    expect(body).not.toMatch(/\bsrc\//);
    expect(body).not.toMatch(/[\w.-]+\.ts\b/);
  });

  it('describes the shared-template and adapter layers by role', () => {
    expect(body).toMatch(/shared-template layer/);
    expect(body).toMatch(/adapter layer/);
  });

  it('requires capability phrasing with a plain-prose fallback', () => {
    expect(flat).toMatch(/capability-plus-fallback/);
    expect(flat).toMatch(/if your agent has one/);
    expect(flat).toMatch(/otherwise/);
  });

  it('forbids instructing a bare agent-specific tool name', () => {
    expect(flat).toMatch(
      /never instruct the agent to use a bare agent-specific tool name/,
    );
  });

  it('requires canonical /rct:<name> references', () => {
    expect(body).toContain('/rct:<name>');
  });

  it('forbids agent-branching prose', () => {
    expect(flat).toMatch(/must not branch on which agent is running/);
  });
});
