import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getBrainstormSkillTemplate,
  getRctBrainstormCommandTemplate,
} from '../../../src/core/templates/workflows/brainstorm.js';
import { generateSkillContent } from '../../../src/core/shared/skill-generation.js';
import { AI_TOOLS } from '../../../src/core/config.js';
import { CommandAdapterRegistry } from '../../../src/core/command-generation/registry.js';
import { generateCommand } from '../../../src/core/command-generation/generator.js';
import type { CommandContent } from '../../../src/core/command-generation/types.js';

/**
 * Brainstorm v7 rendered output: the shared brainstorm body — restated to
 * superpowers v7 in ratchet terms — is asserted on the skill and the command
 * rendered for every registered agent, so the body cannot silently regress to
 * the pre-change shape on any agent. The removed source behaviors (design-doc
 * write, spec reviewer / builder check, writing-plans handoff, companion
 * server dependency) and the replaced pre-change mechanics
 * (one-question-per-message, multiple-choice-first, forced 2-3 approaches) are
 * asserted to stay gone. The payload-conditional spike guidance (the agent
 * reads `spikes.enabled` from the `ratchet instructions brainstorm --json`
 * payload — never config directly — and offers a user-approved, throwaway
 * spike built outside the tracked tree only when the value is true, never
 * mentioning spikes otherwise) is asserted on every registered agent's
 * rendered skill and command.
 *
 * Mirrors:
 * - features/brainstorm/v7-rendered-output.feature
 * - features/brainstorm/spike-guidance.feature
 */

/** Split a rendered body into prose windows (blank-line-separated paragraphs
 * with internal newlines collapsed), so a line-wrapped sentence reads as one
 * window. */
function proseWindows(body: string): string[] {
  return body
    .replace(/\r\n/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/** `/rct:propose` or `/rct:propose-batch`, tolerating adapters that rewrite
 * the `:` to `-`. `\b` after `propose` also matches `propose-batch` (the `-`
 * is a non-word char), which is fine: both are allowed routes. */
const RCT_PROPOSE = /\/rct[:-]propose\b/;
const RCT_PROPOSE_BATCH = /\/rct[:-]propose-batch\b/;

/**
 * v7-behavior predicate over a rendered brainstorm body. Returns one violation
 * per missing v7 behavior; an empty list means the body carries each v7
 * behavior restated in ratchet terms.
 */
function findBrainstormV7Violations(body: string): string[] {
  const flat = body.replace(/\s+/g, ' ');
  const violations: string[] = [];
  const require = (ok: boolean, label: string) => {
    if (!ok) violations.push(label);
  };

  // Triage: a complete request routes straight to /rct:propose.
  require(/\btriage\b/i.test(flat), 'triage step');
  require(
    /complete request/i.test(flat) &&
      new RegExp(`straight to[^.]{0,60}${RCT_PROPOSE.source}`, 'i').test(flat),
    'a complete request is routed straight to /rct:propose',
  );

  // Look before asking, with a first-message echo.
  require(/look before asking/i.test(flat), 'look before asking');
  require(
    /first message/i.test(flat) && /\becho/i.test(flat),
    'first-message echo of what was found and understood',
  );

  // Why-first open questions, then named options with a recommended pick.
  require(/why-first/i.test(flat), 'why-first questioning');
  require(
    /before presenting any set of options/i.test(flat),
    'open questions before any set of options',
  );
  require(
    /named options/i.test(flat) && /recommended pick/i.test(flat),
    'named options with a recommended pick',
  );

  // Ask only when the answer changes what gets built; otherwise a default said
  // aloud as a correctable proposal.
  require(
    /ask only when the answer changes what gets built/i.test(flat),
    'ask only when the answer changes what gets built',
  );
  require(/default[^.]{0,60}aloud/i.test(flat), 'defaults said aloud');
  require(/correctable proposal/i.test(flat), 'correctable proposal');

  // Approaches in their own message; one sensible way allowed.
  require(
    /approaches[^.]{0,80}own message/i.test(flat),
    'approaches presented in their own message',
  );
  require(/one sensible way/i.test(flat), 'one sensible way allowed');
  require(
    /invent extra approaches/i.test(flat),
    'never invent extra approaches to reach a count',
  );

  // Compact playback labelling agent-filled proposals.
  require(/200-300-word/i.test(flat), 'compact 200-300-word playback');
  require(/agent-filled/i.test(flat), 'agent-filled proposals labelled');

  // Skip-ahead opt-out routing to /rct:propose at any point.
  require(
    new RegExp(`skip[- ]ahead[^.]{0,160}${RCT_PROPOSE.source}`, 'i').test(flat),
    'skip-ahead opt-out routing to /rct:propose',
  );

  // Step up a size to /rct:propose-batch for work bigger than one change.
  require(/step up a size/i.test(flat), 'step up a size');
  require(RCT_PROPOSE_BATCH.test(body), 'routes to /rct:propose-batch');

  // The handoff carries the why, the approaches considered, and the non-goals
  // into the proposer's plan sections.
  require(/hand ?off/i.test(flat), 'handoff into the chosen proposer');
  require(/approaches considered/i.test(flat), 'handoff carries the approaches considered');
  require(/non-goals/i.test(flat), 'handoff carries the non-goals');
  require(/##\s*Why/.test(body), 'handoff names the plan `## Why` section');
  require(
    /###\s*Approaches considered/.test(body),
    'handoff names the plan `### Approaches considered` section',
  );
  require(/##\s*Non-goals/.test(body), 'handoff names the plan `## Non-goals` section');

  return violations;
}

/**
 * Removed-behavior predicate over a rendered brainstorm body. Returns one
 * violation per removed source behavior that is no longer stated as removed,
 * per forbidden pre-change mechanic that reappeared, or per route to anything
 * other than /rct:propose / /rct:propose-batch.
 */
function findRemovedBehaviorViolations(body: string): string[] {
  const flat = body.replace(/\s+/g, ' ');
  const violations: string[] = [];
  const require = (ok: boolean, label: string) => {
    if (!ok) violations.push(label);
  };

  // The removed source behaviors must stay stated as removed.
  require(
    /do \*\*not\*\* hand off to a writing-plans skill/i.test(flat),
    'states no writing-plans / implementation-skill handoff',
  );
  require(/write \*\*no\*\* design doc/i.test(flat), 'states no design-doc write');
  require(/no\*?\*? spec self-review/i.test(flat), 'states no spec self-review');
  require(
    /no\*?\*? separate written-spec review/i.test(flat),
    'states no written-spec review gate',
  );
  require(/no skill other than/i.test(flat), 'states routing to no skill other than the proposers');
  require(
    /bundles \*\*no\*\* browser companion server/i.test(flat) ||
      /never depends on any (such )?(companion )?server/i.test(flat),
    'states no companion-server dependency',
  );

  // Routing stays an explicit gate, never automatic.
  require(/explicit gate, never automatic/i.test(flat), 'explicit gate, never automatic');

  // Forbidden: removed behaviors instructed positively, and the pre-change
  // mechanics v7 replaced.
  const forbidden: Array<{ re: RegExp; label: string }> = [
    { re: /invoke the writing-plans skill/i, label: 'instructs a writing-plans handoff' },
    { re: /builder[- ]check/i, label: 'mentions a builder check' },
    { re: /spec reviewer subagent/i, label: 'mentions a spec reviewer subagent' },
    { re: /docs\/superpowers\/specs\//, label: 'references the companion spec path' },
    { re: /one question per message/i, label: 'one-question-per-message wording' },
    { re: /one at a time/i, label: 'one-question-at-a-time wording' },
    { re: /prefer multiple[- ]choice/i, label: 'prefer-multiple-choice wording' },
    { re: /multiple-choice/i, label: 'multiple-choice wording' },
    { re: /two to three/i, label: 'forced two-to-three wording' },
    { re: /2-3 approaches/i, label: 'forced 2-3 approaches wording' },
  ];
  for (const { re, label } of forbidden) {
    if (re.test(body)) violations.push(`forbidden wording present: ${label}`);
  }

  // Routing only to /rct:propose or /rct:propose-batch. The command's own
  // invocation name (rendered into some agents' frontmatter) is a
  // self-reference, not a route.
  const refs = body.match(/\/rct[:-][a-z-]+/g) ?? [];
  for (const ref of refs) {
    if (/^\/rct[:-]brainstorm$/.test(ref)) continue;
    if (!/^\/rct[:-]propose(-batch)?$/.test(ref)) {
      violations.push(`routes to a non-proposer workflow: ${ref}`);
    }
  }

  return violations;
}

/** A sample body in the pre-change shape: no triage, a multiple-choice-first
 * questioning preference, forced two-to-three approaches, no playback, and no
 * skip-ahead opt-out. */
const PRE_CHANGE_BODY = [
  'Brainstorm a rough idea into a validated design, then route it to the right proposer.',
  'Explore the project context first: check relevant files, docs, and recent commits.',
  'Ask clarifying questions one at a time — at most one question per message. Prefer multiple-choice when the options are enumerable; fall back to an open-ended question when multiple choice does not fit. Focus on purpose, constraints, and success criteria.',
  'Propose 2-3 approaches: always present two to three different approaches with their trade-offs, and lead with your recommended approach and explain the reasoning. Apply YAGNI.',
  'Present the design section by section, asking for approval after each section before moving on.',
  'Recommend a route, then route there: a single, cohesive change to `/rct:propose`, a big effort that should be split into phases to `/rct:propose-batch`. Routing is an explicit gate, never automatic.',
  'You invoke no skill other than `/rct:propose` or `/rct:propose-batch`. You do **not** hand off to a writing-plans skill or any implementation skill, you write **no** design doc, you run **no** spec self-review, and you gate **no** separate written-spec review. Ratchet bundles **no** browser companion server and this flow never depends on any such server.',
].join('\n\n');

/** A minimal but well-formed v7 body, used to prove the predicate's
 * accept/reject granularity independently of the shipped template. */
const WELL_FORMED_V7_BODY = [
  'Triage the request first: if the request already names the behavior, who does what, and what should happen, it is a complete request — route it straight to `/rct:propose` and do not run the clarifying dialogue on an already-complete request.',
  'Look before asking: check files, docs, and recent commits before any question or approach, and make your first message an echo of what you found and what you understand of the idea.',
  'Ask why-first open questions about purpose, constraints, and success criteria before presenting any set of options; once the why is understood, present enumerable choices as named options with your recommended pick and the reasoning.',
  'Ask only when the answer changes what gets built; otherwise proceed on a default said aloud as a correctable proposal.',
  'Present the approaches in their own message. When there is genuinely one sensible way, present that single approach and do not invent extra approaches just to reach a count; when real alternatives exist, lead with your recommended approach and apply YAGNI.',
  'Play the design back in a compact 200-300-word summary that labels each default you filled in as agent-filled.',
  'Present the design section by section, asking for approval after each section before moving on.',
  'Skip-ahead opt-out: at any point the user may ask to skip ahead — stop the dialogue and route what is known to `/rct:propose`.',
  'Step up a size to `/rct:propose-batch` when the effort is bigger than one change. Routing is an explicit gate, never automatic.',
  'The handoff carries the why, the approaches considered, and the non-goals into the proposer’s plan under `## Why`, `### Approaches considered`, and `## Non-goals`.',
  'You invoke no skill other than `/rct:propose` or `/rct:propose-batch`. You do **not** hand off to a writing-plans skill or any implementation skill, you write **no** design doc, you run **no** spec self-review, and you gate **no** separate written-spec review. Ratchet bundles **no** browser companion server and this flow never depends on any such server.',
].join('\n\n');

/**
 * Spike-guidance predicate over a rendered brainstorm body. Returns one
 * violation per missing rule of the payload-conditional spike guidance: the
 * payload read (`spikes.enabled` via `ratchet instructions brainstorm
 * --json`), the never-read-config-directly rule, the only-when-true offer
 * naming what the spike would prove, explicit user approval before spike
 * work, throwaway, built outside the tracked tree, keeping routed as a new
 * /rct:propose request, and never mentioned when the value is false or the
 * payload is unavailable. An empty list means the body carries the full
 * payload-conditional spike guidance. Markdown bold markers are stripped
 * before matching so `**never**` reads as `never`.
 */
function findSpikeGuidanceViolations(body: string): string[] {
  const clean = body.replace(/\s+/g, ' ').replace(/\*\*/g, '');
  const violations: string[] = [];
  const require = (ok: boolean, label: string) => {
    if (!ok) violations.push(label);
  };

  // (a) The payload read: the body names the command and the resolved value.
  require(
    /ratchet instructions brainstorm --json/i.test(clean) &&
      /spikes\.enabled/i.test(clean),
    'reads spikes.enabled from the ratchet instructions brainstorm --json payload',
  );

  // (b) Never read the config file directly.
  require(
    /never[^.]{0,80}\.ratchet\/config\.yaml[^.]{0,40}directly/i.test(clean),
    'never reads .ratchet/config.yaml directly',
  );

  // (c) The offer is gated on the payload value true, and names what the
  // spike would prove.
  require(
    /only when[^.]{0,60}true/i.test(clean),
    'offers a spike only when the payload value is true',
  );
  require(
    /names? what (the spike|it) would prove/i.test(clean),
    'the offer names what the spike would prove',
  );

  // (d) No spike work before the user's explicit approval.
  require(
    /no spike work (begins )?before the user's explicit approval/i.test(clean),
    "no spike work before the user's explicit approval",
  );

  // (e) Throwaway.
  require(/throwaway/i.test(clean), 'a spike is throwaway');

  // (f) Built outside the tracked tree.
  require(
    /outside the tracked tree/i.test(clean),
    'built outside the tracked tree',
  );

  // (g) Keeping anything from a spike routes as a new /rct:propose request.
  require(
    new RegExp(
      `keeping[^.]{0,80}routes? as a new[^.]{0,40}${RCT_PROPOSE.source}[^.]{0,20}request`,
      'i',
    ).test(clean),
    'keeping anything from a spike routes as a new /rct:propose request',
  );

  // (h) Spikes are never mentioned when the value is false or the payload is
  // unavailable.
  require(
    /false[^.]{0,80}unavailable[^.]{0,80}(never mention spikes|spikes are never mentioned)/i.test(
      clean,
    ),
    'spikes never mentioned when the value is false or the payload is unavailable',
  );

  return violations;
}

/** A minimal but well-formed payload-conditional spike-guidance body, used to
 * prove the spike predicate's accept/reject granularity independently of the
 * shipped template. */
const WELL_FORMED_SPIKE_BODY = [
  'Run `ratchet instructions brainstorm --json` and read `spikes.enabled` from the payload as data — never read `.ratchet/config.yaml` directly.',
  'Only when the value is `true`, and an approach question is genuinely uncertain, you may offer a spike: name what the spike would prove, and begin no spike work before the user\'s explicit approval.',
  'A spike is throwaway: build it outside the tracked tree in a scratch location and discard it once it has answered its question.',
  'Keeping anything from a spike routes as a new `/rct:propose` request.',
  'When the value is `false` or the payload is unavailable, never mention spikes.',
].join('\n\n');

/** A body that offers spikes unconditionally — no payload read, no
 * never-read-config rule, no only-when-true gate, no silence rule. */
const UNCONDITIONAL_SPIKE_BODY = [
  'When an approach question is genuinely uncertain, offer a spike: name what the spike would prove, and begin no spike work before the user\'s explicit approval.',
  'A spike is throwaway: build it outside the tracked tree in a scratch location and discard it once it has answered its question.',
  'Keeping anything from a spike routes as a new `/rct:propose` request.',
].join('\n\n');

/** A body that reads the config file directly instead of consuming the
 * resolved payload value (instruction-fed-config forbids this). */
const CONFIG_DIRECT_SPIKE_BODY = WELL_FORMED_SPIKE_BODY.replace(
  'Run `ratchet instructions brainstorm --json` and read `spikes.enabled` from the payload as data — never read `.ratchet/config.yaml` directly.',
  'Read `.ratchet/config.yaml` directly to learn whether `brainstorm.spikes` is true.',
);

describe('brainstorm v7 rendered output', () => {
  describe('the v7-behavior predicate', () => {
    it('accepts a well-formed v7 body', () => {
      expect(findBrainstormV7Violations(WELL_FORMED_V7_BODY)).toEqual([]);
      expect(findRemovedBehaviorViolations(WELL_FORMED_V7_BODY)).toEqual([]);
    });

    it('accepts the shipped shared brainstorm body', () => {
      const body = getBrainstormSkillTemplate().instructions;
      expect(findBrainstormV7Violations(body)).toEqual([]);
      expect(findRemovedBehaviorViolations(body)).toEqual([]);
    });

    it('rejects the pre-change body shape', () => {
      const violations = findBrainstormV7Violations(PRE_CHANGE_BODY);
      expect(violations).not.toEqual([]);
      // The pre-change shape misses, among others: triage, why-first, the
      // playback, and the skip-ahead opt-out.
      expect(violations.some((v) => /triage/i.test(v))).toBe(true);
      expect(violations.some((v) => /why-first/i.test(v))).toBe(true);
      expect(violations.some((v) => /playback/i.test(v))).toBe(true);
      expect(violations.some((v) => /skip-ahead/i.test(v))).toBe(true);
    });

    it('rejects a v7 body missing the playback', () => {
      const noPlayback = WELL_FORMED_V7_BODY.replace(
        /Play the design back[^.]*agent-filled\./,
        '',
      );
      const violations = findBrainstormV7Violations(noPlayback);
      expect(violations.some((v) => /playback/i.test(v))).toBe(true);
    });

    it('rejects a v7 body missing the skip-ahead opt-out', () => {
      const noSkipAhead = WELL_FORMED_V7_BODY.replace(
        /Skip-ahead opt-out:[^.]*\/rct:propose`\./,
        '',
      );
      const violations = findBrainstormV7Violations(noSkipAhead);
      expect(violations.some((v) => /skip-ahead/i.test(v))).toBe(true);
    });

    it('rejects the pre-change mechanics on the removed-behavior predicate', () => {
      const violations = findRemovedBehaviorViolations(PRE_CHANGE_BODY);
      expect(violations.some((v) => /one-question-per-message/i.test(v))).toBe(true);
      expect(violations.some((v) => /multiple-choice/i.test(v))).toBe(true);
      expect(violations.some((v) => /two to three|2-3 approaches/i.test(v))).toBe(true);
    });
  });

  describe('render loop over the supported-tools registry', () => {
    it('renders the brainstorm skill for every registered agent with each v7 behavior and the removed behaviors still removed', () => {
      const agents = AI_TOOLS.filter((t) => t.skillsDir);
      // The checked set must be non-empty and cover every registered agent: a
      // registry entry silently skipped by this loop fails here.
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.length).toBe(AI_TOOLS.length);

      for (const tool of agents) {
        const content = generateSkillContent(getBrainstormSkillTemplate(), '0.0.0-test');
        expect(
          findBrainstormV7Violations(content),
          `skill rendered for agent ${tool.value}`,
        ).toEqual([]);
        expect(
          findRemovedBehaviorViolations(content),
          `skill rendered for agent ${tool.value}`,
        ).toEqual([]);
      }
    });

    it('renders the brainstorm command through every registered adapter with each v7 behavior and the removed behaviors still removed', () => {
      const adapters = CommandAdapterRegistry.getAll();
      // Non-empty checked set covering every registered agent, as above.
      expect(adapters.length).toBeGreaterThan(0);
      expect(adapters.length).toBe(AI_TOOLS.length);

      const cmd = getRctBrainstormCommandTemplate();
      const content: CommandContent = {
        id: 'brainstorm',
        name: cmd.name,
        description: cmd.description,
        category: cmd.category,
        tags: cmd.tags,
        body: cmd.content,
      };

      for (const adapter of adapters) {
        const { fileContent } = generateCommand(content, adapter);
        expect(
          findBrainstormV7Violations(fileContent),
          `command rendered for agent ${adapter.toolId}`,
        ).toEqual([]);
        expect(
          findRemovedBehaviorViolations(fileContent),
          `command rendered for agent ${adapter.toolId}`,
        ).toEqual([]);
      }
    });
  });

  describe('the v7 surface stays agent-neutral and defined once', () => {
    it('has the skill template and the command template consume one shared body constant', () => {
      expect(getRctBrainstormCommandTemplate().content).toBe(
        getBrainstormSkillTemplate().instructions,
      );
    });

    it('uses capability-plus-fallback phrasing for the structured-question capability in every rendered body', () => {
      const cmd = getRctBrainstormCommandTemplate();
      const content: CommandContent = {
        id: 'brainstorm',
        name: cmd.name,
        description: cmd.description,
        category: cmd.category,
        tags: cmd.tags,
        body: cmd.content,
      };
      const bodies = [
        generateSkillContent(getBrainstormSkillTemplate(), '0.0.0-test'),
        ...CommandAdapterRegistry.getAll().map(
          (adapter) => generateCommand(content, adapter).fileContent,
        ),
      ];
      expect(bodies.length).toBeGreaterThan(1);
      for (const body of bodies) {
        for (const window of proseWindows(body)) {
          if (!/AskUserQuestion/.test(window)) continue;
          expect(window).toMatch(/if your agent has one/i);
          expect(window).toMatch(/otherwise\b/i);
        }
      }
    });

    it('branches on no agent name in any rendered body', () => {
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
      const cmd = getRctBrainstormCommandTemplate();
      const content: CommandContent = {
        id: 'brainstorm',
        name: cmd.name,
        description: cmd.description,
        category: cmd.category,
        tags: cmd.tags,
        body: cmd.content,
      };
      const rendered: Array<{ label: string; body: string }> = [
        {
          label: 'skill',
          body: generateSkillContent(getBrainstormSkillTemplate(), '0.0.0-test'),
        },
        ...CommandAdapterRegistry.getAll().map((adapter) => ({
          label: `command for ${adapter.toolId}`,
          body: generateCommand(content, adapter).fileContent,
        })),
      ];
      for (const { label, body } of rendered) {
        for (const agent of agentNames) {
          expect(body, `${label} must not name ${agent}`).not.toMatch(
            new RegExp(`\\b${agent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
          );
        }
      }
    });
  });

  describe('the spike-guidance predicate', () => {
    it('accepts a well-formed payload-conditional spike-guidance body', () => {
      expect(findSpikeGuidanceViolations(WELL_FORMED_SPIKE_BODY)).toEqual([]);
    });

    it('accepts the shipped shared brainstorm body', () => {
      const body = getBrainstormSkillTemplate().instructions;
      expect(findSpikeGuidanceViolations(body)).toEqual([]);
    });

    it('rejects an unconditional spike offer', () => {
      const violations = findSpikeGuidanceViolations(UNCONDITIONAL_SPIKE_BODY);
      expect(violations).not.toEqual([]);
      expect(violations.some((v) => /payload/i.test(v))).toBe(true);
      expect(violations.some((v) => /config\.yaml/i.test(v))).toBe(true);
      expect(violations.some((v) => /only when/i.test(v))).toBe(true);
      expect(violations.some((v) => /never mentioned/i.test(v))).toBe(true);
    });

    it('rejects a config-direct read', () => {
      const violations = findSpikeGuidanceViolations(CONFIG_DIRECT_SPIKE_BODY);
      expect(violations).not.toEqual([]);
      expect(violations.some((v) => /payload/i.test(v))).toBe(true);
      expect(violations.some((v) => /never reads \.ratchet\/config\.yaml directly/i.test(v))).toBe(true);
    });

    it('rejects a body missing each individual rule', () => {
      const cases: Array<{ label: RegExp; body: string }> = [
        {
          label: /payload/i,
          body: WELL_FORMED_SPIKE_BODY.replace(
            '`ratchet instructions brainstorm --json`',
            'the brainstorm instructions payload',
          ),
        },
        {
          label: /never reads \.ratchet\/config\.yaml directly/i,
          body: WELL_FORMED_SPIKE_BODY.replace(
            ' — never read `.ratchet/config.yaml` directly',
            '',
          ),
        },
        {
          label: /only when/i,
          body: WELL_FORMED_SPIKE_BODY.replace(
            'Only when the value is `true`, and',
            'When',
          ),
        },
        {
          label: /names what the spike would prove/i,
          body: WELL_FORMED_SPIKE_BODY.replace(
            'name what the spike would prove, and ',
            '',
          ),
        },
        {
          label: /explicit approval/i,
          body: WELL_FORMED_SPIKE_BODY.replace(
            'begin no spike work before the user\'s explicit approval',
            'begin spike work once the user nods',
          ),
        },
        {
          label: /throwaway/i,
          body: WELL_FORMED_SPIKE_BODY.replace('throwaway', 'scratch-built'),
        },
        {
          label: /outside the tracked tree/i,
          body: WELL_FORMED_SPIKE_BODY.replace(
            'outside the tracked tree',
            'in a scratch folder',
          ),
        },
        {
          label: /routes as a new \/rct:propose request/i,
          body: WELL_FORMED_SPIKE_BODY.replace(
            'Keeping anything from a spike routes as a new `/rct:propose` request.\n\n',
            '',
          ),
        },
        {
          label: /never mentioned/i,
          body: WELL_FORMED_SPIKE_BODY.replace(
            '\n\nWhen the value is `false` or the payload is unavailable, never mention spikes.',
            '',
          ),
        },
      ];
      for (const { label, body } of cases) {
        const violations = findSpikeGuidanceViolations(body);
        expect(
          violations.some((v) => label.test(v)),
          `expected a violation matching ${label} in: ${violations.join(', ')}`,
        ).toBe(true);
      }
    });
  });

  describe('spike-guidance render loop over the supported-tools registry', () => {
    it('renders the brainstorm skill for every registered agent with the payload-conditional spike guidance', () => {
      const agents = AI_TOOLS.filter((t) => t.skillsDir);
      // The checked set must be non-empty and cover every registered agent: a
      // registry entry silently skipped by this loop fails here.
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.length).toBe(AI_TOOLS.length);

      for (const tool of agents) {
        const content = generateSkillContent(getBrainstormSkillTemplate(), '0.0.0-test');
        expect(
          findSpikeGuidanceViolations(content),
          `skill rendered for agent ${tool.value}`,
        ).toEqual([]);
      }
    });

    it('renders the brainstorm command through every registered adapter with the payload-conditional spike guidance', () => {
      const adapters = CommandAdapterRegistry.getAll();
      // Non-empty checked set covering every registered agent, as above.
      expect(adapters.length).toBeGreaterThan(0);
      expect(adapters.length).toBe(AI_TOOLS.length);

      const cmd = getRctBrainstormCommandTemplate();
      const content: CommandContent = {
        id: 'brainstorm',
        name: cmd.name,
        description: cmd.description,
        category: cmd.category,
        tags: cmd.tags,
        body: cmd.content,
      };

      for (const adapter of adapters) {
        const { fileContent } = generateCommand(content, adapter);
        expect(
          findSpikeGuidanceViolations(fileContent),
          `command rendered for agent ${adapter.toolId}`,
        ).toEqual([]);
      }
    });
  });

  describe('the provenance header', () => {
    // The subject of these assertions is the shipped template file itself, so
    // this block intentionally reads the real repository file rather than a
    // tmpdir fixture.
    const templatePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../src/core/templates/workflows/brainstorm.ts',
    );
    const source = readFileSync(templatePath, 'utf-8');
    const header = source.slice(0, source.indexOf('*/'));
    // Normalized form for phrase assertions: strip the doc-comment's leading
    // `*` line markers, then collapse whitespace across line wraps.
    const headerFlat = header
      .replace(/\s*\n\s*\*\s?/g, ' ')
      .replace(/\s+/g, ' ');

    it('records the exact string "superpowers 7.0.2" as the absorbed upstream baseline', () => {
      expect(header).toContain('superpowers 7.0.2');
      expect(headerFlat).toMatch(/absorbed upstream baseline/i);
    });

    it('restates the summary line and the adapted/removed list', () => {
      // The summary line no longer describes the pre-change mechanics.
      expect(headerFlat).not.toMatch(/questions one at a time/i);
      expect(headerFlat).not.toMatch(/2-3 approaches/);
      // The replaced-by-v7 list names the three replaced mechanics.
      expect(headerFlat).toMatch(/one-question-per-message/);
      expect(headerFlat).toMatch(/multiple-choice-first/);
      expect(headerFlat).toMatch(/two-to-three approaches/);
      // The still-removed list names the removed source behaviors.
      expect(headerFlat).toMatch(/design-doc write/i);
      expect(headerFlat).toMatch(/builder-check spec reviewer subagent/i);
      expect(headerFlat).toMatch(/written-spec/i);
      expect(headerFlat).toMatch(/writing-plans/i);
      expect(headerFlat).toMatch(/sub-projects/i);
      expect(headerFlat).toMatch(/companion server/i);
    });
  });

  describe('the restated surface is Reference-documented', () => {
    // Same real-file justification as the provenance block: these assertions
    // pin the shipped README / Reference wording itself.
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf-8');
    const generatedArtifacts = readFileSync(
      path.join(repoRoot, 'docs/configuration/generated-artifacts.md'),
      'utf-8',
    );

    it('README brainstorm descriptions no longer carry the pre-change mechanics', () => {
      expect(readme).not.toMatch(/clarifies one question at a time/i);
      expect(readme).not.toMatch(/clarifying questions one at a time/i);
      expect(readme).not.toMatch(/weighs 2[–-]3 approaches/i);
    });

    it('the generated-artifacts Reference entry for the brainstorm surface stays accurate', () => {
      // The skill directory / command id mapping is unchanged by the restatement.
      expect(generatedArtifacts).toMatch(/\| `brainstorm` \| `ratchet-brainstorm` \| `brainstorm` \|/);
    });

    it('documents the payload-conditional spike guidance for the brainstorm workflow', () => {
      // The Reference entry names the payload seam, the four spike rules, and
      // the silence rule.
      expect(generatedArtifacts).toMatch(/spike guidance/i);
      expect(generatedArtifacts).toMatch(/ratchet instructions brainstorm --json/);
      expect(generatedArtifacts).toMatch(/spikes\.enabled/);
      expect(generatedArtifacts).toMatch(/never reads?\s+`?\.ratchet\/config\.yaml`?\s+directly/i);
      expect(generatedArtifacts).toMatch(/explicit approval/i);
      expect(generatedArtifacts).toMatch(/throwaway/i);
      expect(generatedArtifacts).toMatch(/outside the tracked tree/i);
      expect(generatedArtifacts).toMatch(/routes\s+as\s+a\s+new\s+`\/rct:propose`\s+request/i);
      expect(generatedArtifacts).toMatch(/never mentions spikes/i);
    });
  });
});

/**
 * README credits record the absorbed upstream baselines: the shipped
 * README.md's `## Credits & license` section is asserted to carry the exact
 * strings `OpenSpec 2.0.0` and `superpowers 7.0.2`, labelled as the absorbed
 * upstream baselines (the versions the upstream-absorption batch restated in
 * ratchet terms), with the existing fork attribution (fork of OpenSpec by
 * Fission-AI) and the MIT license statement preserved.
 *
 * Mirrors:
 * - features/upstream-credits/readme-baselines.feature
 */
describe('README credits record the absorbed upstream baselines', () => {
  // Same real-file justification as the README pins above: these assertions
  // pin the shipped README credits wording itself.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf-8');
  const creditsSection = readme.slice(readme.indexOf('## Credits & license'));

  it('records the exact string "OpenSpec 2.0.0" as an absorbed upstream baseline', () => {
    expect(creditsSection).toMatch(/OpenSpec 2\.0\.0/);
    expect(creditsSection).toMatch(/absorbed upstream baselines?:[^\n]*OpenSpec 2\.0\.0/i);
  });

  it('records the exact string "superpowers 7.0.2" as an absorbed upstream baseline', () => {
    expect(creditsSection).toMatch(/superpowers 7\.0\.2/);
    expect(creditsSection).toMatch(/absorbed upstream baselines?:[^\n]*superpowers 7\.0\.2/i);
  });

  it('keeps the existing fork attribution and MIT license statement alongside the baselines', () => {
    expect(creditsSection).toMatch(/fork of \[OpenSpec\]\(https:\/\/github\.com\/Fission-AI\/OpenSpec\) by Fission-AI/);
    expect(creditsSection).toMatch(/Licensed under MIT\./);
  });
});
