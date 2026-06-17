import { describe, it, expect } from 'vitest';
import {
  resolvePermissionFlags,
  REPO_SANDBOX_DENY_PATTERNS,
} from '../../src/core/batch/runtime/agent-permissions.js';
import type {
  ResolvedPermissionsPolicy,
  PermissionPosture,
} from '../../src/core/batch/permissions-policy.js';

const REPO = '/work/repo';

function policy(over: Partial<ResolvedPermissionsPolicy> = {}): ResolvedPermissionsPolicy {
  return {
    posture: 'repo-sandboxed-permissive',
    allow: [],
    deny: [],
    raw: {},
    ...over,
  };
}

describe('resolvePermissionFlags — claude (verified flags)', () => {
  it('repo-sandboxed-permissive emits acceptEdits + --add-dir <repo> + allow Bash + denylist', () => {
    const flags = resolvePermissionFlags('claude', policy(), REPO);
    expect(flags).toContain('--permission-mode');
    expect(flags[flags.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
    expect(flags).toContain('--add-dir');
    expect(flags[flags.indexOf('--add-dir') + 1]).toBe(REPO);
    // acceptEdits covers edits only, so Bash must be explicitly allowed for the
    // headless agent to run shell unattended (verified empirically with claude -p).
    expect(flags).toContain('--allowedTools');
    expect(flags[flags.indexOf('--allowedTools') + 1]).toBe('Bash');
    // The denylist is still emitted alongside the allow (deny beats allow).
    expect(flags).toContain('--disallowedTools');
    // The repo-sandbox baseline denials are present.
    for (const pattern of REPO_SANDBOX_DENY_PATTERNS) {
      expect(flags).toContain(pattern);
    }
    // The sandboxed default is NOT a permission bypass.
    expect(flags).not.toContain('--dangerously-skip-permissions');
  });

  it('repo-sandboxed-permissive honors the operator allow list verbatim (no implicit Bash)', () => {
    const flags = resolvePermissionFlags(
      'claude',
      policy({ allow: ['Bash(git *)', 'Edit'] }),
      REPO
    );
    // When the operator configured an allow list, it is used as-is (the default
    // ['Bash'] only applies when no allow list was given).
    expect(flags).toContain('--allowedTools');
    expect(flags).toContain('Bash(git *)');
    expect(flags).toContain('Edit');
    expect(flags).not.toContain('Bash'); // exact 'Bash' is not implicitly added
    // Denylist still present.
    expect(flags).toContain('--disallowedTools');
  });

  it('full-autonomy emits the skip-permissions flag and nothing else', () => {
    const flags = resolvePermissionFlags('claude', policy({ posture: 'full-autonomy' }), REPO);
    expect(flags).toEqual(['--dangerously-skip-permissions']);
  });

  it('curated-allowlist emits default mode + allow + deny lists, no bypass', () => {
    const flags = resolvePermissionFlags(
      'claude',
      policy({ posture: 'curated-allowlist', allow: ['Edit', 'Bash(git *)'], deny: ['Bash(rm *)'] }),
      REPO
    );
    expect(flags[flags.indexOf('--permission-mode') + 1]).toBe('default');
    expect(flags).toContain('--allowedTools');
    expect(flags).toContain('Edit');
    expect(flags).toContain('Bash(git *)');
    expect(flags).toContain('--disallowedTools');
    expect(flags).toContain('Bash(rm *)');
    expect(flags).not.toContain('--dangerously-skip-permissions');
    // curated does NOT inject the repo-sandbox baseline (only the operator deny).
    expect(flags).not.toContain('Bash(sudo *)');
  });

  it('operator deny patterns union with the sandbox baseline under the default posture', () => {
    const flags = resolvePermissionFlags(
      'claude',
      policy({ deny: ['Bash(:(){ :|:& };:)'] }),
      REPO
    );
    expect(flags).toContain('Bash(sudo *)'); // baseline
    expect(flags).toContain('Bash(:(){ :|:& };:)'); // operator-added
  });
});

describe('resolvePermissionFlags — gemini (verified flags)', () => {
  // DOCUMENTED LIMITATION: gemini has no argv-only way to allow bounded shell
  // (`--allowed-tools` is deprecated; the Policy Engine is file-based, violating
  // the locked argv-only decision). So sandboxed stays the bounded `auto_edit`
  // mapping — which auto-approves EDITS ONLY and may prompt/stall on shell in
  // headless mode (empirically confirmed). We intentionally do NOT promote it to
  // `yolo` (full autonomy). This assertion pins that bounded mapping and the
  // invariant that sandboxed never silently becomes yolo.
  it('repo-sandboxed-permissive maps to bounded --approval-mode auto_edit (NOT yolo)', () => {
    const flags = resolvePermissionFlags('gemini', policy(), REPO);
    expect(flags).toEqual(['--approval-mode', 'auto_edit']);
    expect(flags).not.toContain('--yolo');
    expect(flags).not.toContain('yolo');
  });
  it('curated-allowlist maps to --approval-mode default', () => {
    const flags = resolvePermissionFlags('gemini', policy({ posture: 'curated-allowlist' }), REPO);
    expect(flags).toEqual(['--approval-mode', 'default']);
  });
  it('full-autonomy maps to --yolo', () => {
    const flags = resolvePermissionFlags('gemini', policy({ posture: 'full-autonomy' }), REPO);
    expect(flags).toEqual(['--yolo']);
  });
});

describe('resolvePermissionFlags — codex/cursor (verify-at-apply mappings)', () => {
  it('codex sandboxed uses --sandbox workspace-write + approval never', () => {
    const flags = resolvePermissionFlags('codex', policy(), REPO);
    expect(flags).toContain('--sandbox');
    expect(flags[flags.indexOf('--sandbox') + 1]).toBe('workspace-write');
    expect(flags).toContain('--ask-for-approval');
    expect(flags[flags.indexOf('--ask-for-approval') + 1]).toBe('never');
  });
  it('codex full-autonomy uses --full-auto', () => {
    expect(resolvePermissionFlags('codex', policy({ posture: 'full-autonomy' }), REPO)).toEqual([
      '--full-auto',
    ]);
  });
  it('cursor reserves the --force bypass for full-autonomy ONLY', () => {
    expect(resolvePermissionFlags('cursor', policy({ posture: 'full-autonomy' }), REPO)).toContain(
      '--force'
    );
  });
  it('cursor sandboxed/curated do NOT emit the --force bypass', () => {
    // Regression guard for the safety defect: a "sandboxed" cursor run must never
    // carry the same unattended bypass as full-autonomy.
    expect(resolvePermissionFlags('cursor', policy(), REPO)).not.toContain('--force');
    expect(
      resolvePermissionFlags('cursor', policy({ posture: 'curated-allowlist' }), REPO)
    ).not.toContain('--force');
  });
});

describe('resolvePermissionFlags — per-agent raw override (escape hatch)', () => {
  it('appends the matching agent raw flags after the posture flags', () => {
    const flags = resolvePermissionFlags(
      'claude',
      policy({ raw: { claude: ['--mcp-config', '/tmp/mcp.json'] } }),
      REPO
    );
    expect(flags.slice(-2)).toEqual(['--mcp-config', '/tmp/mcp.json']);
    // base posture flags still present
    expect(flags).toContain('--permission-mode');
  });

  it('ignores a raw override targeting a different agent', () => {
    const flags = resolvePermissionFlags(
      'claude',
      policy({ raw: { codex: ['--codex-only-flag'] } }),
      REPO
    );
    expect(flags).not.toContain('--codex-only-flag');
  });

  it('an unknown agent still honors its own raw entry and emits no posture flags', () => {
    const flags = resolvePermissionFlags(
      'future-agent',
      { posture: 'full-autonomy', allow: [], deny: [], raw: {} },
      REPO
    );
    expect(flags).toEqual([]);
  });
});

describe('repo-sandbox denylist patterns (default posture)', () => {
  const sandboxDeny = resolvePermissionFlags('claude', policy(), REPO);
  const has = (needle: RegExp) => sandboxDeny.some((f) => needle.test(f));

  it('forbids destructive recursive delete (rm -rf, incl. outside repo)', () => {
    expect(has(/rm -rf/)).toBe(true);
  });
  it('forbids privilege escalation (sudo)', () => {
    expect(has(/sudo/)).toBe(true);
  });
  it('forbids writes redirected to an absolute path outside the repo', () => {
    expect(has(/> \/\*/)).toBe(true);
  });
  it('forbids obvious network-exfil pipe-to-shell (curl|sh, wget|bash)', () => {
    expect(has(/curl .* \| sh/)).toBe(true);
    expect(has(/wget .* \| bash/)).toBe(true);
  });
});

describe('every posture resolves for every supported agent without throwing', () => {
  const postures: PermissionPosture[] = [
    'repo-sandboxed-permissive',
    'curated-allowlist',
    'full-autonomy',
  ];
  for (const agent of ['claude', 'gemini', 'codex', 'cursor']) {
    for (const posture of postures) {
      it(`${agent} / ${posture}`, () => {
        const flags = resolvePermissionFlags(agent, policy({ posture }), REPO);
        expect(Array.isArray(flags)).toBe(true);
      });
    }
  }
});

describe('safety invariant — sandboxed/curated must NOT equal full-autonomy', () => {
  // The core promise of the permission abstraction: for EVERY agent, a bounded
  // posture must translate to a flag set that DIFFERS from full-autonomy. This is
  // the regression guard for the cursor defect (where all three postures returned
  // ['--force']) and protects every other adapter from regressing the same way.
  for (const agent of ['claude', 'gemini', 'codex', 'cursor']) {
    const full = resolvePermissionFlags(agent, policy({ posture: 'full-autonomy' }), REPO);
    it(`${agent}: repo-sandboxed-permissive ≠ full-autonomy`, () => {
      const sandboxed = resolvePermissionFlags(
        agent,
        policy({ posture: 'repo-sandboxed-permissive' }),
        REPO
      );
      expect(sandboxed).not.toEqual(full);
    });
    it(`${agent}: curated-allowlist ≠ full-autonomy`, () => {
      const curated = resolvePermissionFlags(
        agent,
        policy({ posture: 'curated-allowlist' }),
        REPO
      );
      expect(curated).not.toEqual(full);
    });
  }
});
