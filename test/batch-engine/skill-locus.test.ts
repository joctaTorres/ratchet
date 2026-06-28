import { describe, it, expect } from 'vitest';
import path from 'node:path';
import type { BatchSettings, ProofOfWork } from 'ratchet-ai';
import type { ChangeStepContext, Transition } from '../../src/core/batch/engine/contract.js';
import {
  ensureSkillInSpawnLocus,
  rctCommandIdForTransition,
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
