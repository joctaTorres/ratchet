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
 *
 * UNATTENDED SHELL (verified empirically with `claude -p` 2.x): a permission mode
 * that auto-accepts edits (claude `acceptEdits`, gemini `auto_edit`) covers FILE
 * EDITS ONLY — every Bash/shell tool call still hits the permission engine and, in
 * headless mode, is DENIED/STALLS unless explicitly allowed. So the sandboxed
 * claude mapping ALSO emits `--allowedTools` including `Bash` (defaulting to
 * `['Bash']` when the operator configured no allow list), while still emitting the
 * `--disallowedTools` denylist; DENY BEATS ALLOW is verified (a denylisted
 * `Bash(sudo *)` stays refused even with `Bash` allowed). The `curated-allowlist`
 * posture allows ONLY the listed tools, so operators MUST include a `Bash(...)`
 * allow entry there or shell steps stall headless. This all stays argv-only — no
 * `--settings` file. Gemini has NO argv-only way to allow bounded shell
 * (`--allowed-tools` is deprecated; the Policy Engine is file-based), so its
 * sandboxed mapping stays the bounded `auto_edit` and is documented as a limitation
 * (it may prompt/stall on shell) rather than overreaching to `yolo` — see below.
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
 *
 * SANDBOXED — why `acceptEdits` ALONE is not enough (verified empirically with
 * `claude -p` 2.x): `acceptEdits` auto-accepts FILE EDITS only. Every `Bash` tool
 * call still hits the permission engine, and in headless `-p` mode an un-allowed
 * Bash command is denied outright ("requires approval"), stalling the agent — e.g.
 * `uv --version` is refused. So we ALSO emit `--allowedTools` including `Bash` so
 * ordinary shell runs unattended. The denylist is kept via `--disallowedTools`,
 * and DENY BEATS ALLOW (verified: with `--allowedTools Bash` present, a denylisted
 * `Bash(sudo *)` is still refused). We deliberately do NOT use
 * `--dangerously-skip-permissions` here — that is reserved for `full-autonomy`;
 * acceptEdits+allow+deny is strictly narrower. Stays argv-only (no `--settings`).
 */
function claudeFlags(policy: ResolvedPermissionsPolicy, repoRoot: string): string[] {
  const deny = effectiveDenyList(policy);
  switch (policy.posture) {
    case 'full-autonomy':
      return ['--dangerously-skip-permissions'];
    case 'curated-allowlist': {
      // NOTE: curated allows ONLY the listed tools by design — operators MUST
      // include a `Bash(...)` allow entry (e.g. `Bash` or `Bash(git *)`) or any
      // shell step will stall headless, exactly as the sandboxed posture would
      // without an explicit Bash allow. See the module header.
      const flags = ['--permission-mode', 'default'];
      if (policy.allow.length > 0) flags.push('--allowedTools', ...policy.allow);
      if (deny.length > 0) flags.push('--disallowedTools', ...deny);
      return flags;
    }
    case 'repo-sandboxed-permissive':
    default: {
      const flags = ['--permission-mode', 'acceptEdits', '--add-dir', repoRoot];
      // Explicit Bash allow: acceptEdits covers edits only, so without this every
      // Bash call stalls headless. Default to ['Bash'] when the operator gave no
      // allow list; otherwise honor the operator's list verbatim.
      const allow = policy.allow.length > 0 ? policy.allow : ['Bash'];
      flags.push('--allowedTools', ...allow);
      // Deny beats allow (verified) — the sandbox denylist still wins over Bash.
      if (deny.length > 0) flags.push('--disallowedTools', ...deny);
      return flags;
    }
  }
}

/**
 * Gemini (verified against `gemini --help` on the build machine, gemini 0.46.0):
 * `--approval-mode {default,auto_edit,yolo,plan}` and `-y/--yolo`.
 *
 * KNOWN LIMITATION — bounded-unattended-shell is NOT expressible in gemini's argv.
 * `auto_edit` auto-approves EDIT tools only; like claude's `acceptEdits` it does
 * NOT cover the shell, so a `run_shell_command` in headless `-p` mode prompts and
 * STALLS (empirically confirmed: an `auto_edit` headless run on a shell command
 * hung indefinitely and had to be killed). Unlike claude, gemini offers no
 * argv-only allow path to fix this: `--allowed-tools` is explicitly DEPRECATED
 * ("Use Policy Engine instead"), and the supported Policy Engine
 * (`--policy`/`--admin-policy`) loads policy FILES/DIRECTORIES — which violates our
 * locked argv-only decision (no temp-file lifecycle). The only argv-only escape is
 * `yolo`, which auto-approves ALL tools = full-autonomy semantics, far too broad.
 *
 * GROUNDED CALL: we keep the BOUNDED `auto_edit` mapping for sandboxed (honest and
 * strictly narrower than yolo) and do NOT silently promote it to `yolo`. The
 * accepted consequence is that gemini-sandboxed may prompt/stall on shell steps in
 * headless mode — bounded-unattended-shell simply isn't expressible for gemini
 * under argv-only. Revisit if gemini gains a non-deprecated argv allow-tool flag.
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
 *
 * Researched from the Cursor CLI docs (cursor.com/docs/cli/reference/permissions
 * and .../configuration): `--force` is a BYPASS flag — in print mode it skips the
 * write-file confirmation, i.e. it grants the same unattended write authority that
 * `full-autonomy` intends. Cursor's allow/deny permission lists are configured via
 * a config file (`permissions.allow` / `permissions.deny`), NOT via argv, so under
 * our locked argv-only decision we cannot inject a bounded allow/deny here.
 *
 * INVARIANT: the sandboxed/curated postures MUST NOT emit `--force`. Without it,
 * cursor falls back to its default approval-prompting behavior, which is strictly
 * more bounded than the bypass. `--force` is therefore reserved for
 * `full-autonomy` ONLY. Because argv cannot express a bounded allow/deny for
 * cursor, the sandboxed/curated invocation is best-effort (relies on cursor's own
 * default gating) — we emit a one-time warning so a "sandboxed" label is never
 * silently equivalent to full autonomy. Re-verify exact flags once `cursor-agent`
 * is on PATH (e.g. a config-file-based allow/deny or a future approval-mode flag).
 */
function cursorFlags(policy: ResolvedPermissionsPolicy): string[] {
  switch (policy.posture) {
    case 'full-autonomy':
      // BYPASS: skip write/command confirmation entirely. Bypass lives here only.
      return ['--force'];
    case 'curated-allowlist':
    case 'repo-sandboxed-permissive':
    default:
      // No `--force` → cursor keeps its default per-action approval gating. argv
      // cannot carry cursor's allow/deny (config-file only), so warn once that
      // this posture is bounded only by cursor's own defaults, not by our policy.
      warnCursorBestEffort(policy.posture);
      return [];
  }
}

/**
 * One-time-per-process warning that a non-full-autonomy cursor posture is bounded
 * only by cursor-agent's built-in approval gating (argv cannot carry our policy's
 * allow/deny for cursor). Keeps the mapper effectively pure for callers — the
 * warning fires at most once per posture and never alters the returned argv.
 */
const warnedCursorPostures = new Set<string>();
function warnCursorBestEffort(posture: string): void {
  if (warnedCursorPostures.has(posture)) return;
  warnedCursorPostures.add(posture);
  console.warn(
    `[batch] cursor-agent: posture "${posture}" cannot be enforced via argv ` +
      `(cursor's allow/deny is config-file only). Falling back to cursor's default ` +
      `per-action approval gating — NOT the bypass. Verify at apply.`
  );
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
  const agent = agentName as PermissionRawAgent;
  const mapper = AGENT_MAPPERS[agent];
  const postureFlags = mapper ? mapper(policy, repoRoot) : [];
  const rawForAgent = policy.raw[agent] ?? [];
  return [...postureFlags, ...rawForAgent];
}
