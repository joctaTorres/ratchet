/**
 * Web-binding scope detection: whether `ratchet doctor` should probe for
 * Playwright at all. Reuses `loadEvalSpecs` — the exact resolver `eval
 * set`/`eval run` already use — so "in scope" means "resolved from the
 * project's eval specs," with no second, divergent notion of scope. A missing
 * specs directory, deterministic/llm-judge-only bindings, and spec files that
 * fail to parse/validate all resolve to `false` for free, since the resolver
 * already tolerates them (missing dir -> no files; invalid entries -> warned
 * and skipped).
 */

import { loadEvalSpecs } from '../eval/index.js';

/** True iff any eval binding resolved from `projectRoot` has `kind: 'web'`. */
export function hasWebBindingInScope(projectRoot: string): boolean {
  const { bindings } = loadEvalSpecs(projectRoot);
  for (const resolved of bindings.values()) {
    if (resolved.binding.kind === 'web') return true;
  }
  return false;
}
