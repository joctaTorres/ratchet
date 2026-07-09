/**
 * PR-remote check (optional/informational, conditionally appended).
 *
 * When PR grouping is active, a completed batch spawns a PR agent that pushes the
 * work branch and opens a PR. If the repo has no configured git remote, that push
 * has nowhere to go and the batch fails only at the very end. This check surfaces
 * the missing remote up front — but ONLY when it is actually relevant: it returns
 * `null` (→ omitted from the report entirely, never a passing or skipped row)
 * whenever doctor should stay silent, mirroring how `playwright` is conditionally
 * appended. Deciding silent-vs-warn lives here so there is exactly one git probe
 * and one clear rule.
 *
 * The remote probe routes through `deps.run` (like `checkDocker`) so the check is
 * unit-testable with an in-memory fake. It names no forge-specific CLI
 * (`gh`/`glab`/etc.) — `git` itself is the version-control substrate, and which
 * forge opens the PR stays out of ratchet (`generalizable-defaults`).
 */

import type { BootstrapDeps } from '../../batch/engine/runtime/rex-bootstrap.js';
import { resolveBatchSettings, isPrGroupingActive } from '../../batch/config.js';
import type { DoctorCheck } from '../types.js';

const ID = 'pr-remote';
const LABEL = 'Git remote (PR grouping)';

/**
 * Run the PR-remote check, returning one `DoctorCheck` only when `prGrouping` is
 * active and the repo has no configured git remote; `null` otherwise (silent).
 */
export function checkPrRemote(
  deps: BootstrapDeps,
  projectRoot: string
): DoctorCheck | null {
  const { prGrouping } = resolveBatchSettings(projectRoot).settings;
  // Silent when PR grouping is not active (`off`, the default) — nothing to push,
  // nothing to warn. The shared predicate is the single home for this rule, so the
  // warning automatically covers every non-`off` mode as the vocabulary grows.
  if (!isPrGroupingActive(prGrouping)) return null;

  // `git remote` lists one configured remote name per line. A remote is
  // configured iff the command exits 0 AND its trimmed stdout is non-empty.
  // Any other outcome (non-zero exit / empty output) is treated as "no remote",
  // the safe direction for an advisory-only check that never blocks.
  const res = deps.run('git', ['-C', projectRoot, 'remote']);
  const hasRemote = res.status === 0 && res.stdout.trim() !== '';
  if (hasRemote) return null;

  return {
    id: ID,
    label: LABEL,
    status: 'info',
    severity: 'optional',
    detail:
      'PR grouping is active but this repo has no configured git remote to push to. ' +
      'A completed batch will spawn a PR agent that pushes the work branch and opens a ' +
      'PR, which needs a remote.',
    remedy:
      'Configure a git remote (e.g. `git remote add <name> <url>`) so the PR agent can ' +
      'push the work branch and open a PR.',
  };
}
