import { describe, it, expect } from 'vitest';
import { program } from '../../src/cli/index.js';

/**
 * Blackbox test for the top-level `Workflow:` help section. The five workflow
 * commands (`propose`, `apply`, `verify`, `batch`, `eval`) are tagged with
 * Commander v14 help groups via `.helpGroup('Workflow:')`, so the rendered help
 * gathers them under a single `Workflow:` heading in workflow order, while the
 * setup/utility commands keep their default `Commands:` placement.
 *
 * Assertions are made on the index/order of substrings in the rendered help so
 * they stay resilient to surrounding whitespace and styling.
 */
describe('top-level help: Workflow group', () => {
  const help = program.helpInformation();

  it('renders a "Workflow:" heading produced by help groups', () => {
    expect(help).toContain('Workflow:');
  });

  it('lists propose, apply, verify, batch, eval in workflow order under the heading', () => {
    const workflowIdx = help.indexOf('Workflow:');
    expect(workflowIdx).toBeGreaterThanOrEqual(0);

    // All five workflow commands live after the heading...
    const proposeIdx = help.indexOf('propose', workflowIdx);
    const applyIdx = help.indexOf('apply', workflowIdx);
    const verifyIdx = help.indexOf('verify', workflowIdx);
    const batchIdx = help.indexOf('batch', workflowIdx);
    const evalIdx = help.indexOf('eval', workflowIdx);

    expect(proposeIdx).toBeGreaterThan(workflowIdx);
    // ...and they appear in propose → apply → verify → batch → eval order.
    expect(applyIdx).toBeGreaterThan(proposeIdx);
    expect(verifyIdx).toBeGreaterThan(applyIdx);
    expect(batchIdx).toBeGreaterThan(verifyIdx);
    expect(evalIdx).toBeGreaterThan(batchIdx);
  });

  it('keeps unrelated commands in the default group, before the Workflow heading', () => {
    const workflowIdx = help.indexOf('Workflow:');
    const unrelated = [
      'init',
      'update',
      'list',
      'view',
      'archive',
      'validate',
      'doctor',
      'status',
      'instructions',
      'template',
      'new',
    ];
    for (const name of unrelated) {
      const idx = help.indexOf(`\n  ${name}`);
      // Present in the help output...
      expect(idx, `${name} should be listed`).toBeGreaterThanOrEqual(0);
      // ...and NOT pulled under the Workflow heading (it precedes it).
      expect(idx, `${name} should stay in the default group`).toBeLessThan(workflowIdx);
    }
  });
});
