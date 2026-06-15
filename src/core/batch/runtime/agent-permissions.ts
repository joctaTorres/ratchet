/**
 * Agent-permissions translator: turn one agent-agnostic permission policy into a
 * concrete argv fragment for a specific coding agent.
 *
 * This is the ONLY place agent-specific permission flags live. Everything above
 * it (config scopes, the resolved policy) is agent-neutral; the engine adapter
 * appends `resolvePermissionFlags(agentName, policy, repoRoot)` to each agent's
 * base argv. The module is PURE — policy in, argv fragment out — so it is fully
 * unit-testable without spawning anything.
 *
 * DECISION (locked): argv flags ONLY — no `--settings` JSON file. The policy is
 * injected exclusively via command-line flags so it flows trivially through the
 * local sidecar, docker, and remote-REST loci with no temp-file lifecycle.
 * ACCEPTED CONSEQUENCE: denials are COARSE / tool-level — "rm -rf outside repo"
 * and "curl | sh" become blunt Bash-tool denials, not path-aware rules.
 *
 * VERIFY AT APPLY: claude and gemini flags are confirmed from `--help` on the
 * build machine. codex and cursor-agent are NOT installed here — their mappings
 * are the documented intended design and are flagged accordingly below; they are
 * unit-tested as pure mappings, to be re-verified once those binaries are present.
 */

import type {
  ResolvedPermissionsPolicy,
  PermissionRawAgent,
} from '../permissions-policy.js';

/**
 * Agent-neutral denylist for the `repo-sandboxed-permissive` posture. These are
 * the dangerous operations that must stay forbidden even when ordinary in-repo
 * work runs unprompted: destructive recursive deletes, privilege escalation,
 * out-of-repo writes, and obvious network-exfil shell pipes. They are encoded as
 * Bash-tool patterns and translated to each agent's denial mechanism. Because the
 * route is argv-only, the patterns are COARSE (tool/command-level), not
 * path-aware — see the module header.
 */
export const REPO_SANDBOX_DENY_PATTERNS: readonly string[] = [
  'Bash(rm -rf *)', // destructive recursive delete (incl. paths outside the repo)
  'Bash(sudo *)', // privilege escalation
  'Bash(* > /*)', // write redirected to an absolute path outside the repo
  'Bash(curl * | sh)', // pipe-to-shell network exfil/execution
  'Bash(curl * | bash)',
  'Bash(wget * | sh)',
  'Bash(wget * | bash)',
];

/**
 * Build the effective deny list for a posture: the posture's built-in denials
 * (the repo-sandbox baseline) unioned with any operator-configured `deny`
 * patterns. `full-autonomy` intentionally drops the baseline (the operator has
 * opted out of all checks); `curated-allowlist` and the sandboxed default keep it.
 */
function effectiveDenyList(policy: ResolvedPermissionsPolicy): string[] {
  const base =
    policy.posture === 'repo-sandboxed-permissive' ? [...REPO_SANDBOX_DENY_PATTERNS] : [];
  const merged = [...base, ...policy.deny];
  // De-dupe while preserving order (baseline first, operator patterns after).
  return [...new Set(merged)];
}

// -----------------------------------------------------------------------------
// Per-agent mappers. Each returns the permission argv fragment (NOT including the
// agent's base flags, which the adapter already owns).
// -----------------------------------------------------------------------------

/**
 * Claude (verified against `claude --help`). `--permission-mode` choices include
 * `acceptEdits | default | …`; `--allowedTools`/`--disallowedTools` take
 * space/comma-separated tool names; `--add-dir` scopes allowed directories;
 * `--dangerously-skip-permissions` bypasses all checks.
 */
function claudeFlags(policy: ResolvedPermissionsPolicy, repoRoot: string): string[] {
  const deny = effectiveDenyList(policy);
  switch (policy.posture) {
    case 'full-autonomy':
      return ['--dangerously-skip-permissions'];
    case 'curated-allowlist': {
      const flags = ['--permission-mode', 'default'];
      if (policy.allow.length > 0) flags.push('--allowedTools', ...policy.allow);
      if (deny.length > 0) flags.push('--disallowedTools', ...deny);
      return flags;
    }
    case 'repo-sandboxed-permissive':
    default: {
      const flags = ['--permission-mode', 'acceptEdits', '--add-dir', repoRoot];
      if (deny.length > 0) flags.push('--disallowedTools', ...deny);
      // An allow list is additive even under the sandboxed posture if configured.
      if (policy.allow.length > 0) flags.push('--allowedTools', ...policy.allow);
      return flags;
    }
  }
}

/**
 * Gemini (verified against `gemini --help`): `--approval-mode {default,auto_edit,
 * yolo,plan}` and `-y/--yolo`. Gemini has no argv allow/deny list, so allow/deny
 * patterns can only influence the approval mode (coarse, per the locked decision).
 */
function geminiFlags(policy: ResolvedPermissionsPolicy): string[] {
  switch (policy.posture) {
    case 'full-autonomy':
      return ['--yolo'];
    case 'curated-allowlist':
      return ['--approval-mode', 'default'];
    case 'repo-sandboxed-permissive':
    default:
      return ['--approval-mode', 'auto_edit'];
  }
}

/**
 * Codex — VERIFY AT APPLY (binary not installed on the build machine). Intended
 * mapping per the plan's table: sandboxed work uses `--sandbox workspace-write`
 * with approvals off; curated keeps the workspace sandbox with default approvals;
 * full-autonomy uses `--full-auto`. Re-verify exact spellings once `codex` is on
 * PATH.
 */
function codexFlags(policy: ResolvedPermissionsPolicy): string[] {
  switch (policy.posture) {
    case 'full-autonomy':
      return ['--full-auto'];
    case 'curated-allowlist':
      return ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'];
    case 'repo-sandboxed-permissive':
    default:
      return ['--sandbox', 'workspace-write', '--ask-for-approval', 'never'];
  }
}

/**
 * cursor-agent — VERIFY AT APPLY (binary not installed on the build machine).
 * Intended mapping per the plan's table: a force/non-interactive flag for
 * unattended work, escalating to a force-all flag for full-autonomy. Re-verify
 * exact spellings once `cursor-agent` is on PATH.
 */
function cursorFlags(policy: ResolvedPermissionsPolicy): string[] {
  switch (policy.posture) {
    case 'full-autonomy':
      return ['--force'];
    case 'curated-allowlist':
      return ['--force'];
    case 'repo-sandboxed-permissive':
    default:
      return ['--force'];
  }
}

type Mapper = (policy: ResolvedPermissionsPolicy, repoRoot: string) => string[];

const AGENT_MAPPERS: Record<PermissionRawAgent, Mapper> = {
  claude: (policy, repoRoot) => claudeFlags(policy, repoRoot),
  gemini: (policy) => geminiFlags(policy),
  codex: (policy) => codexFlags(policy),
  cursor: (policy) => cursorFlags(policy),
};

/**
 * Resolve the permission argv fragment for one agent under a resolved policy.
 *
 * Returns the posture-derived flags for the named agent, followed by any
 * per-agent `raw` override flags for THAT agent (the escape hatch). A `raw`
 * override targeting a different agent is ignored. An unrecognized agent name
 * yields no posture flags but still honors a `raw` entry if one happens to match,
 * so an unknown future agent can be driven entirely via `raw`.
 *
 * Pure: no I/O, no spawning.
 */
export function resolvePermissionFlags(
  agentName: string,
  policy: ResolvedPermissionsPolicy,
  repoRoot: string
): string[] {
  const mapper = AGENT_MAPPERS[agentName as PermissionRawAgent];
  const postureFlags = mapper ? mapper(policy, repoRoot) : [];
  const rawForAgent = policy.raw[agentName as PermissionRawAgent] ?? [];
  return [...postureFlags, ...rawForAgent];
}
