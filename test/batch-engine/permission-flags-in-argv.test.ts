import { describe, it, expect } from 'vitest';
import { resolveAdapter } from '../../src/core/batch/engine/agent.js';
import { buildRunCommand } from '../../src/core/batch/engine/runtime/rex-sidecar-runtime.js';
import { buildRemoteRunCommand } from '../../src/core/batch/engine/runtime/rex-remote-runtime.js';
import type { ResolvedPermissionsPolicy } from '../../src/core/batch/permissions-policy.js';

/**
 * e2e: the resolved permission flags the adapter appends must survive into the
 * argv each locus actually executes. The sidecar (local + docker) and the remote
 * runtime both build the agent command from `request.command + request.args`
 * verbatim, so asserting on both command builders covers all three loci.
 */

const REPO = '/work/repo';

function policy(over: Partial<ResolvedPermissionsPolicy> = {}): ResolvedPermissionsPolicy {
  return { posture: 'repo-sandboxed-permissive', allow: [], deny: [], raw: {}, ...over };
}

describe('permission flags flow into the spawned argv across loci', () => {
  it('claude sandboxed flags appear in the adapter argv', () => {
    const ctx = { batch: 'b', change: 'c', settings: { permissions: policy() } };
    const req = resolveAdapter('claude').buildRequest(ctx, 'instr', REPO, {});
    // base flags untouched, then the permission flags
    expect(req.args.slice(0, 5)).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ]);
    expect(req.args).toContain('--permission-mode');
    expect(req.args).toContain('acceptEdits');
    expect(req.args).toContain('--add-dir');
    expect(req.args).toContain(REPO);
    expect(req.args).toContain('--disallowedTools');
  });

  it('the local/docker sidecar run command embeds the permission flags', () => {
    const ctx = { batch: 'b', change: 'c', settings: { permissions: policy() } };
    const req = resolveAdapter('claude').buildRequest(ctx, 'instr', REPO, {});
    const cmd = buildRunCommand('/tmp/prompt.txt', req);
    // The builder shell-quotes each token, so assert on the quoted forms.
    expect(cmd).toContain("'--permission-mode' 'acceptEdits'");
    expect(cmd).toContain("'--add-dir'");
  });

  it('the remote run command embeds the permission flags', () => {
    const ctx = { batch: 'b', change: 'c', settings: { permissions: policy() } };
    const req = resolveAdapter('claude').buildRequest(ctx, 'instr', REPO, {});
    const cmd = buildRemoteRunCommand('/srv/prompt.txt', req);
    expect(cmd).toContain("'--permission-mode' 'acceptEdits'");
  });

  it('a per-agent raw override survives into the executed argv', () => {
    const ctx = {
      batch: 'b',
      change: 'c',
      settings: { permissions: policy({ raw: { claude: ['--mcp-config', '/tmp/m.json'] } }) },
    };
    const req = resolveAdapter('claude').buildRequest(ctx, 'instr', REPO, {});
    expect(buildRunCommand('/tmp/p.txt', req)).toContain('--mcp-config');
  });

  it('with no permissions in context the argv is unchanged (minimal callers)', () => {
    const req = resolveAdapter('claude').buildRequest({ batch: 'b', change: 'c' }, 'instr', REPO, {});
    expect(req.args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ]);
  });
});
