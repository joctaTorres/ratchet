/**
 * Playwright CLI check (optional/informational, conditionally appended).
 *
 * Playwright is only needed once a project has opted into a `kind: web` eval
 * binding — deciding WHETHER to run this check at all is the orchestrator's
 * job (`runDoctorChecks`, gated by `hasWebBindingInScope`). This module stays
 * a pure, unconditional check like `checkDocker`: given deps, it always
 * probes and always returns a verdict.
 *
 * The probe mirrors the web lifecycle harness's own invocation (`npx
 * playwright test ...` in `web-lifecycle.ts`) since Playwright is the actual
 * declared dependency of a `kind: web` binding, not a general package-manager
 * assumption. `--no-install` is required so the probe never triggers npx's
 * implicit network install when Playwright isn't present — a doctor check
 * must be fast and side-effect-free.
 */

import type { BootstrapDeps } from '../../batch/engine/runtime/rex-bootstrap.js';
import type { DoctorCheck } from '../types.js';
import { PLAYWRIGHT_NPX_PACKAGE } from '../../eval/web-lifecycle.js';

const ID = 'playwright';
const LABEL = 'Playwright CLI';

const INSTALL_REMEDY =
  'Optional: install Playwright (`npm install -D @playwright/test && npx playwright install`) ' +
  'if you plan to use a `kind: web` eval binding.';

/** Run the Playwright check, returning one `DoctorCheck`. Pure (deps injected). */
export function checkPlaywright(deps: BootstrapDeps): DoctorCheck {
  const res = deps.run('npx', ['--no-install', PLAYWRIGHT_NPX_PACKAGE, '--version']);
  if (res.status === 0) {
    const version = (res.stdout || res.stderr).trim();
    return {
      id: ID,
      label: LABEL,
      status: 'pass',
      severity: 'optional',
      detail: `Playwright is installed (${version || 'version unknown'}).`,
    };
  }

  return {
    id: ID,
    label: LABEL,
    status: 'info',
    severity: 'optional',
    detail:
      'Playwright is not installed. This is only needed for `kind: web` eval bindings.',
    remedy: INSTALL_REMEDY,
  };
}
