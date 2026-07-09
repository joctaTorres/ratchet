import { describe, it, expect } from 'vitest';
import path from 'node:path';
import type { BatchSettings, ProofOfWork } from 'ratchet-ai';
import type { ChangeStepContext, Transition } from '../../src/core/batch/engine/contract.js';
import {
  ensureSkillInSpawnLocus,
  ensureCommandInSpawnLocus,
  rctCommandIdForTransition,
  PR_OPEN_COMMAND_ID,
  SkillLocusError,
  type SkillLocusDeps,
} from '../../src/core/batch/engine/skill-locus.js';
import { availableAdapters } from '../../src/core/batch/engine/agent.js';
import { CommandAdapterRegistry } from '../../src/core/command-generation/index.js';
import { getCommandContents } from '../../src/core/shared/skill-generation.js';

/**
 * Unit tests for the skill-in-spawn-locus guarantee. All side effects go through
 * fake `SkillLocusDeps`, so nothing touches disk. The applicable agent set is the
 * batch-engine SPAWNABLE registry (`availableAdapters()` → claude, codex, cursor,
 * gemini), driven from the registry so it stays correct if a spawn adapter is
 * added — never hard-coding a single agent.
 */

const ROOT = '/tmp/spawn-locus-project';
const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };

/** The batch-engine spawnable agents — the only agents this guarantee runs for. */
const SPAWNABLE_AGENTS = availableAdapters();

function settings(over: Partial<BatchSettings> = {}): BatchSettings {
  return {
    gate: 'voluntary',
    strategy: 'vertical-slice',
    proofOfWork: 'hard-gate',
    locus: 'local',
    agent: 'claude',
    ...over,
  };
}

function context(over: Partial<ChangeStepContext> = {}): ChangeStepContext {
  return {
    change: 'add-login-api',
    changeDone: 'login works',
    transition: 'apply',
    phase: { name: 'p1', goal: 'g', success: 's', proofOfWork: POW },
    settings: settings(over.settings),
    journal: [],
    ...over,
  };
}

/** A fake deps seam recording writes; `exists` is backed by the same store. */
function fakeDeps(initial: Record<string, string> = {}): {
  deps: SkillLocusDeps;
  writes: Map<string, string>;
} {
  const writes = new Map<string, string>(Object.entries(initial));
  return {
    writes,
    deps: {
      exists: (p) => writes.has(p),
      writeText: (p, content) => {
        writes.set(p, content);
      },
    },
  };
}

/** The absolute path an agent's adapter renders the command to under the root. */
function expectedPath(agent: string, commandId: string): string {
  const adapter = CommandAdapterRegistry.get(agent);
  if (!adapter) throw new Error(`no command adapter for ${agent}`);
  const p = adapter.getFilePath(commandId);
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

describe('rctCommandIdForTransition', () => {
  it('maps each transition to exactly its own canonical rct command', () => {
    expect(rctCommandIdForTransition('propose')).toBe('propose');
    expect(rctCommandIdForTransition('apply')).toBe('apply');
    expect(rctCommandIdForTransition('verify')).toBe('verify');
  });
});

describe('ensureSkillInSpawnLocus — renders a missing command through the per-agent adapter', () => {
  for (const agent of SPAWNABLE_AGENTS) {
    it(`renders apply at ${agent}'s adapter path from the shared command content`, () => {
      const { deps, writes } = fakeDeps();
      ensureSkillInSpawnLocus(context({ settings: settings({ agent }) }), ROOT, deps);

      const target = expectedPath(agent, 'apply');
      expect(writes.has(target)).toBe(true);

      // The content comes from the SHARED command definition, not a hand-authored
      // engine-local copy: it equals the agent adapter's formatFile of the shared
      // CommandContent for this id.
      const shared = getCommandContents(['apply']).find((c) => c.id === 'apply')!;
      const adapter = CommandAdapterRegistry.get(agent)!;
      expect(writes.get(target)).toBe(adapter.formatFile(shared));
    });
  }

  it('never hard-codes a single agent path — each agent renders at its own adapter path', () => {
    const targets = new Set<string>();
    for (const agent of SPAWNABLE_AGENTS) {
      const { deps, writes } = fakeDeps();
      ensureSkillInSpawnLocus(context({ settings: settings({ agent }) }), ROOT, deps);
      const target = expectedPath(agent, 'apply');
      expect([...writes.keys()]).toEqual([target]);
      targets.add(target);
    }
    // The agents resolve to distinct adapter paths (claude/codex/cursor/gemini all
    // differ), proving the path is registry-resolved, not a single literal.
    expect(targets.size).toBe(SPAWNABLE_AGENTS.length);
  });
});

describe('ensureSkillInSpawnLocus — an already-present command is verified, not overwritten', () => {
  it('leaves the existing file untouched', () => {
    const agent = 'claude';
    const target = expectedPath(agent, 'apply');
    const { deps, writes } = fakeDeps({ [target]: 'PRE-EXISTING CONTENT' });
    ensureSkillInSpawnLocus(context({ settings: settings({ agent }) }), ROOT, deps);
    expect(writes.get(target)).toBe('PRE-EXISTING CONTENT');
  });
});

describe('ensureSkillInSpawnLocus — the transition selects its own canonical command', () => {
  const cases: Transition[] = ['propose', 'apply', 'verify'];
  for (const transition of cases) {
    it(`guarantees exactly /rct:${transition} for transition ${transition}`, () => {
      const { deps, writes } = fakeDeps();
      ensureSkillInSpawnLocus(context({ transition }), ROOT, deps);
      const target = expectedPath('claude', transition);
      expect([...writes.keys()]).toEqual([target]);
    });
  }
});

describe('ensureSkillInSpawnLocus — a locus the engine cannot render into fails', () => {
  it('throws an actionable SkillLocusError for remote, naming the command + locus + remedy', () => {
    const { deps, writes } = fakeDeps();
    let thrown: unknown;
    try {
      ensureSkillInSpawnLocus(
        context({ settings: settings({ locus: 'remote', host: 'h', port: 1, authToken: 't' }) }),
        ROOT,
        deps
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(SkillLocusError);
    const msg = (thrown as Error).message;
    expect(msg).toContain('/rct:apply'); // names the missing command
    expect(msg).toContain('remote'); // names the locus
    expect(msg).toMatch(/local|docker|render/i); // states a remedy
    expect(msg).not.toMatch(/invoke `?\/rct:apply/); // never tells the agent to run it
    expect(writes.size).toBe(0); // nothing rendered
  });

  it('renders the invocation token through the per-agent adapter, not a hard-coded /rct:<id>', () => {
    const { deps } = fakeDeps();
    // A non-claude spawn agent uses `/rct-<id>` syntax, so the operator message
    // must cite `/rct-apply` (its real token) — not the claude `/rct:apply`.
    let thrown: unknown;
    try {
      ensureSkillInSpawnLocus(
        context({ settings: settings({ agent: 'gemini', locus: 'remote', host: 'h', port: 1, authToken: 't' }) }),
        ROOT,
        deps
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(SkillLocusError);
    const msg = (thrown as Error).message;
    expect(msg).toContain('/rct-apply'); // gemini's real invocation token
    expect(msg).not.toContain('/rct:apply'); // not the hard-coded claude token
  });
});

describe('PR_OPEN_COMMAND_ID — the whole-batch PR-open command id lives in one place', () => {
  it('is the single-source `open-pr` constant', () => {
    expect(PR_OPEN_COMMAND_ID).toBe('open-pr');
  });
});

describe('ensureCommandInSpawnLocus — guarantees the open-pr command for the `pr` stage', () => {
  for (const agent of SPAWNABLE_AGENTS) {
    it(`renders open-pr at ${agent}'s adapter path from the shared command content`, () => {
      const { deps, writes } = fakeDeps();
      // The `pr` stage selects which agent runs the PR step; the command id
      // selects the instruction it runs. Guarantee the `open-pr` command for the
      // agent the `pr` stage resolves to.
      ensureCommandInSpawnLocus(PR_OPEN_COMMAND_ID, settings({ agent }), ROOT, deps, 'pr');

      const target = expectedPath(agent, PR_OPEN_COMMAND_ID);
      expect(writes.has(target)).toBe(true);

      // Content comes from the SHARED command definition, not a hand-authored copy.
      const shared = getCommandContents([PR_OPEN_COMMAND_ID]).find((c) => c.id === PR_OPEN_COMMAND_ID)!;
      const adapter = CommandAdapterRegistry.get(agent)!;
      expect(writes.get(target)).toBe(adapter.formatFile(shared));
    });
  }

  it('never hard-codes a single agent path — each agent renders open-pr at its own adapter path', () => {
    const targets = new Set<string>();
    for (const agent of SPAWNABLE_AGENTS) {
      const { deps, writes } = fakeDeps();
      ensureCommandInSpawnLocus(PR_OPEN_COMMAND_ID, settings({ agent }), ROOT, deps, 'pr');
      const target = expectedPath(agent, PR_OPEN_COMMAND_ID);
      expect([...writes.keys()]).toEqual([target]);
      targets.add(target);
    }
    expect(targets.size).toBe(SPAWNABLE_AGENTS.length);
  });

  it('leaves an already-present open-pr command file untouched', () => {
    const agent = 'claude';
    const target = expectedPath(agent, PR_OPEN_COMMAND_ID);
    const { deps, writes } = fakeDeps({ [target]: 'PRE-EXISTING CONTENT' });
    ensureCommandInSpawnLocus(PR_OPEN_COMMAND_ID, settings({ agent }), ROOT, deps, 'pr');
    expect(writes.get(target)).toBe('PRE-EXISTING CONTENT');
  });

  it('throws an actionable SkillLocusError naming open-pr for a remote locus', () => {
    const { deps, writes } = fakeDeps();
    let thrown: unknown;
    try {
      ensureCommandInSpawnLocus(
        PR_OPEN_COMMAND_ID,
        settings({ locus: 'remote', host: 'h', port: 1, authToken: 't' }),
        ROOT,
        deps,
        'pr'
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(SkillLocusError);
    const msg = (thrown as Error).message;
    expect(msg).toContain('open-pr'); // names the command
    expect(msg).toContain('remote'); // names the locus
    expect(msg).toMatch(/local|docker|render/i); // states a remedy
    expect(writes.size).toBe(0); // nothing rendered
  });
});

describe('ensureSkillInSpawnLocus — a render failure surfaces as a SkillLocusError', () => {
  it('wraps a failed write in an actionable bootstrap error, not a raw throw', () => {
    const deps: SkillLocusDeps = {
      exists: () => false,
      writeText: () => {
        throw new Error('EACCES: permission denied');
      },
    };
    let thrown: unknown;
    try {
      ensureSkillInSpawnLocus(context(), ROOT, deps);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(SkillLocusError);
    const msg = (thrown as Error).message;
    expect(msg).toContain('/rct:apply');
    expect(msg).toContain(expectedPath('claude', 'apply'));
    expect(msg).toContain('EACCES'); // surfaces the underlying detail
  });
});

/**
 * Implements: features/standalone-agent-flag/engine-structured-failure.feature
 * Scenario: the spawn-locus guarantee wraps a malformed spec into SkillLocusError
 * naming the value.
 *
 * A malformed resolved spec (one that slipped past upstream validation, or a
 * future regression that removes it) must NOT escape `ensureCommandInSpawnLocus`
 * as a raw `Error` from `parseAgentSpec` — the engine's catch blocks handle only
 * `SkillLocusError`/`UnknownAgentError`, so a raw throw would crash the process
 * instead of failing the step structurally. The wrap funnels it into the same
 * structured `SkillLocusError` channel the engine already maps to a resumable
 * `failed` step, naming the offending value and stating the agent is NOT spawned.
 */
describe('ensureCommandInSpawnLocus — a malformed resolved spec wraps into SkillLocusError naming the value (engine-structured-failure.feature)', () => {
  it('a malformed spec "claude:" throws SkillLocusError (not a plain Error) naming "claude:" and stating the agent is not spawned', () => {
    const { deps, writes } = fakeDeps();
    let thrown: unknown;
    try {
      ensureCommandInSpawnLocus('apply', settings({ agent: 'claude:' }), ROOT, deps, 'apply');
    } catch (err) {
      thrown = err;
    }
    // SkillLocusError, NOT a plain Error — the engine's catch blocks handle only
    // SkillLocusError/UnknownAgentError, so a raw throw would crash the process.
    expect(thrown).toBeInstanceOf(SkillLocusError);
    // Assert the name field directly: it must be exactly 'SkillLocusError',
    // not 'Error' (a plain Error from parseAgentSpec would have name 'Error').
    expect((thrown as Error).name).toBe('SkillLocusError');
    const msg = (thrown as Error).message;
    expect(msg).toContain('claude:'); // names the offending value
    expect(msg).toMatch(/not spawned/i); // states the agent is NOT spawned
    expect(writes.size).toBe(0); // nothing rendered
  });

  it('a whitespace-padded spec " claude" throws SkillLocusError naming the value', () => {
    const { deps, writes } = fakeDeps();
    let thrown: unknown;
    try {
      ensureCommandInSpawnLocus('apply', settings({ agent: ' claude' }), ROOT, deps, 'apply');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(SkillLocusError);
    expect((thrown as Error).name).toBe('SkillLocusError');
    expect((thrown as Error).message).toContain(' claude');
    expect(writes.size).toBe(0);
  });

  it('a dash-model spec "claude:-flag" throws SkillLocusError naming the value', () => {
    const { deps, writes } = fakeDeps();
    let thrown: unknown;
    try {
      ensureCommandInSpawnLocus('apply', settings({ agent: 'claude:-flag' }), ROOT, deps, 'apply');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(SkillLocusError);
    expect((thrown as Error).name).toBe('SkillLocusError');
    expect((thrown as Error).message).toContain('claude:-flag');
    expect(writes.size).toBe(0);
  });
});

/**
 * Implements: features/standalone-agent-flag/engine-structured-failure.feature
 * Scenario: a well-formed spec still resolves the spawn-locus guarantee unchanged.
 *
 * A valid spec-form value (`claude:fable`) must still resolve the "claude"
 * command adapter and render/guarantee the claude rct command file — the wrap
 * only catches malformed specs, never valid ones. The agent part selects the
 * command adapter; the model part is irrelevant to the locus guarantee.
 */
describe('ensureCommandInSpawnLocus — a well-formed spec resolves the spawn-locus guarantee unchanged (engine-structured-failure.feature)', () => {
  it('a valid spec "claude:fable" resolves the "claude" command adapter and renders the command file without error', () => {
    const { deps, writes } = fakeDeps();
    ensureCommandInSpawnLocus('apply', settings({ agent: 'claude:fable' }), ROOT, deps, 'apply');
    // The claude command file was rendered at the claude adapter path — proving
    // the agent part was resolved and the guarantee did not skip.
    const target = expectedPath('claude', 'apply');
    expect(writes.has(target)).toBe(true);

    // The content comes from the SHARED command definition, formatted through
    // the claude adapter — exactly the same as a bare `claude` agent value.
    const shared = getCommandContents(['apply']).find((c) => c.id === 'apply')!;
    const adapter = CommandAdapterRegistry.get('claude')!;
    expect(writes.get(target)).toBe(adapter.formatFile(shared));
  });
});
