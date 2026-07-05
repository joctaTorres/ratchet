/**
 * PR-open opens against the SUPPLIED base branch.
 *
 * Implements: features/pr-instruction-stacked-base/supplied-base.feature
 *
 * The `ratchet instructions` payload the engine builds for the PR-open command
 * (`buildPrInstructions` → `prInputContext`) must carry whatever base branch the
 * `PrStepContext` supplies — including an arbitrary stacked sibling branch that is
 * NOT the repository's default — verbatim as the sole PR target, deriving nothing
 * from git. The shared, forge-agnostic `PR_OPEN_BODY` must direct opening exactly
 * one PR against that supplied base and must not invent, infer, or re-derive it,
 * nor read any ratchet config to resolve it. The base flows identically for every
 * registered agent (only the invocation token differs), and the render-or-fail
 * skill-locus guarantee for the PR-open command is unchanged by carrying the base
 * as data.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPrInstructions,
  prJournalKey,
} from '../../src/core/batch/engine/instructions.js';
import {
  ensureCommandInSpawnLocus,
  PR_OPEN_COMMAND_ID,
  SkillLocusError,
  type SkillLocusDeps,
} from '../../src/core/batch/engine/skill-locus.js';
import type { PrStepContext } from '../../src/core/batch/engine/contract.js';
import type { BatchSettings, ProofOfWork } from '../../src/core/batch/config.js';
import { CommandAdapterRegistry } from '../../src/core/command-generation/index.js';
import {
  getPrOpenSkillTemplate,
  getRctPrOpenCommandTemplate,
} from '../../src/core/templates/workflows/pr-open.js';

const BATCH = 'stack-batch';
const POW: ProofOfWork = { kind: 'integration', run: 'echo ok', pass: 'exit 0' };

// A stacked sibling base that is deliberately NOT a repo default branch, so a
// SUPPLIED base and an implicit/git-derived one can never be confused.
const SIBLING_BASE = 'stack/phase-1-branch';
const DEFAULT_BASE = 'main';
const WORK = 'stack/phase-2-work';

function settings(over: Partial<BatchSettings> = {}): BatchSettings {
  return {
    gate: 'voluntary',
    strategy: 'vertical-slice',
    proofOfWork: 'hard-gate',
    locus: 'local',
    prGrouping: 'whole-batch',
    ...over,
  };
}

function prCtx(over: Partial<PrStepContext> = {}): PrStepContext {
  return {
    batch: BATCH,
    phase: { name: 'terminal', goal: 'open the PR', success: 's', proofOfWork: POW },
    settings: settings(),
    baseBranch: SIBLING_BASE,
    workBranch: WORK,
    ...over,
  };
}

// --- 2.1: buildPrInstructions carries the supplied base verbatim -------------

describe('buildPrInstructions — carries an arbitrary supplied base verbatim', () => {
  it('names the exact non-default supplied base as the PR target and the work branch as source', () => {
    const instr = buildPrInstructions(prCtx({ baseBranch: SIBLING_BASE, workBranch: WORK }));
    // The stacked sibling base is the PR target, verbatim.
    expect(instr).toContain(SIBLING_BASE);
    // The supplied work branch is the PR source.
    expect(instr).toContain(WORK);
    // FROM the work branch TO the supplied base — the direction is explicit.
    expect(instr).toMatch(
      new RegExp(`FROM the work branch "${WORK}" TO`)
    );
    expect(instr).toContain(`the supplied base branch "${SIBLING_BASE}"`);
  });

  it('derives nothing from git: no default-branch/upstream fallback leaks into the payload', () => {
    const instr = buildPrInstructions(prCtx({ baseBranch: SIBLING_BASE }));
    // The sibling base is NOT 'main'; the engine must not have substituted a
    // repo-default or an `origin/HEAD`-style git-derived base.
    expect(instr).not.toContain('origin/HEAD');
    // The only base named as the target is the supplied sibling, not 'main'.
    expect(instr).not.toContain(`base branch "${DEFAULT_BASE}"`);
  });

  it('a default-base context and a sibling-base context differ ONLY by the base value', () => {
    const withDefault = buildPrInstructions(prCtx({ baseBranch: DEFAULT_BASE }));
    const withSibling = buildPrInstructions(prCtx({ baseBranch: SIBLING_BASE }));

    // Same shared assembly, same work branch, same delegation — the sole
    // difference is the base value. Substitute the sibling base back to the
    // default and the two payloads become byte-for-byte identical.
    expect(withSibling.split(SIBLING_BASE).join(DEFAULT_BASE)).toBe(withDefault);
    // Sanity: they were genuinely different before the substitution.
    expect(withSibling).not.toBe(withDefault);
  });

  it('reports under the PR journal key, not a change name', () => {
    const instr = buildPrInstructions(prCtx());
    expect(instr).toContain(`--change ${prJournalKey(BATCH)}`);
  });
});

// --- 2.2: the shared body opens against the supplied base only ---------------

describe('PR_OPEN_BODY — the shared body opens against the supplied base only', () => {
  const body = getPrOpenSkillTemplate().instructions;

  it('the command body IS the skill body (one shared, byte-for-byte author)', () => {
    expect(getRctPrOpenCommandTemplate().content).toBe(body);
  });

  it('directs opening EXACTLY ONE pull request against the supplied base', () => {
    expect(body).toMatch(/exactly one/i);
    expect(body).toMatch(/pull request/i);
    // The base is the one the surrounding instructions supply — not a default- or
    // whole-batch-only assumption.
    expect(body).toMatch(/base branch the surrounding\s+instructions supply/i);
    expect(body).toMatch(/supplied base/i);
    // Never more than one PR.
    expect(body).toMatch(/never more than one/i);
  });

  it('instructs the agent NOT to invent, infer, or re-derive the base', () => {
    expect(body).toMatch(/invent, infer, or re-derive/i);
    // Names the specific illegitimate sources it must not fall back to.
    expect(body).toMatch(/default branch/i);
    expect(body).toMatch(/upstream/i);
  });

  it('reads no ratchet config to resolve the base and has no if-config branching', () => {
    // No instruction to open a ratchet config file to resolve the base.
    expect(body).not.toMatch(/\.ratchet\b/);
    expect(body).not.toMatch(/ratchet\.ya?ml/i);
    expect(body).not.toMatch(/config\.ya?ml/i);
    // No "if config says X then target Y" branching over the base.
    expect(body).not.toMatch(/if config/i);
  });
});

// --- 2.3a: the supplied base flows for EVERY registered agent ----------------

describe('buildPrInstructions — the supplied base flows for every registered agent', () => {
  const adapters = CommandAdapterRegistry.getAll();

  it('the registry covers the full supported agent set', () => {
    expect(adapters.length).toBeGreaterThanOrEqual(5);
  });

  for (const adapter of adapters) {
    it(`${adapter.toolId}: names the same supplied base and its own invocation token`, () => {
      const instr = buildPrInstructions(
        prCtx({ settings: settings({ agent: { pr: adapter.toolId } }) })
      );
      // Same supplied base for every agent — no agent special-cased in resolution.
      expect(instr).toContain(SIBLING_BASE);
      // The invocation token is this agent's own syntax for the shared command id.
      expect(instr).toContain(adapter.getInvocation(PR_OPEN_COMMAND_ID));
    });
  }

  it('ONLY the invocation token differs per agent — the rest is identical', () => {
    const PLACEHOLDER = '<<PR_OPEN_INVOCATION>>';
    const normalized = adapters.map((adapter) => {
      const instr = buildPrInstructions(
        prCtx({ settings: settings({ agent: { pr: adapter.toolId } }) })
      );
      // Strip out the agent-specific invocation token; everything else — the
      // supplied base, the work branch, the delegation prose — must match.
      return instr.split(adapter.getInvocation(PR_OPEN_COMMAND_ID)).join(PLACEHOLDER);
    });
    for (const n of normalized) {
      expect(n).toBe(normalized[0]);
    }
    // Guard the normalization actually removed a token per agent (distinct tokens
    // across agents — claude `/rct:pr-open` vs the others' `/rct-pr-open`).
    const tokens = new Set(adapters.map((a) => a.getInvocation(PR_OPEN_COMMAND_ID)));
    expect(tokens.size).toBeGreaterThan(1);
  });
});

// --- 2.3b: render-or-fail skill-locus guarantee is unchanged -----------------

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

const ROOT = '/tmp/pr-instruction-stacked-base-project';

describe('render-or-fail — the PR-open command guarantee is unchanged by carrying the base as data', () => {
  it('renders the pr-open command from the shared definition when absent', () => {
    const { deps, writes } = fakeDeps();
    ensureCommandInSpawnLocus(PR_OPEN_COMMAND_ID, settings({ agent: 'claude' }), ROOT, deps, 'pr');
    // Exactly one file written — the pr-open command at claude's adapter path.
    expect(writes.size).toBe(1);
  });

  it('fails actionably on an unrenderable (remote) locus, naming the command + locus', () => {
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
    expect(msg).toContain('pr-open'); // names the missing command
    expect(msg).toContain('remote'); // names the locus
    expect(writes.size).toBe(0); // no agent spawned against a base it cannot run
  });
});
