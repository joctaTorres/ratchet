---
tag: security-remediation
---

# Complete remediation of severe security exposures

> Concern: security

## Intent

A security exposure classified severe or high MUST be remediated completely, or
not claimed remediated at all. A partial fix that presents as complete is worse
than no fix: it closes the tracking issue, silences review, and leaves the
exposure live behind a surface that reports it handled. This standard makes
partial remediation of severe exposures a defect that propose must plan around
and verify must fail.

## Guidelines

- **No partial remediation of severe exposures.** A change addressing a
  security exposure classified severe or high — including agent/command hijack,
  permission or sandbox bypass, authentication/authorization bypass, arbitrary
  code execution, secret/credential exposure, and data-integrity or audit-trail
  forgery — MUST fully remediate every material requirement of that exposure
  before the change is considered done. The plan MUST enumerate the exposure's
  material requirements explicitly, and each enumerated requirement MUST map to
  an implemented and verified task in the same change. Shipping a subset of the
  requirements and marking the change done is prohibited.
- **Severity governs, not source wording.** Hedged or optional phrasing in a
  source issue — "consider", "maybe", "nice to have", "optionally", "could" —
  does NOT lower the remediation bar. The exposure's severity classification
  determines what MUST be fixed; issue prose determines nothing about the bar.
  When a source issue hedges a requirement of a severe exposure, the change
  MUST treat that requirement as mandatory or defer it under the explicit
  deferral rule below — never silently downgrade it.
- **Honest close-claims.** A `Fixes #N` / `Closes #N` reference (or a batch
  manifest marking a security issue done) may assert closure ONLY when every
  material security requirement of that issue is implemented AND verified. A
  change that ships less MUST state "partially addresses #N" and MUST NOT mark
  the issue closed. A close-claim MUST NOT be hard-coded into a manifest or
  plan before the exposure's material requirements have been enumerated: a
  close-claim is an output of verification, never an input of planning.
- **No silent scope drops.** Security-relevant scope MUST NOT be deferred or
  dropped via plan prose, a manifest paraphrase, or a phase boundary. Any
  deferral of a security requirement REQUIRES all three of: an explicitly filed
  tracking issue linked from the change, a named owner on that issue, and
  explicit human sign-off recorded in the change. A de-scope of security,
  permissions, or data-integrity work is a stop-and-surface event — the change
  halts and asks — never a momentum or path-of-least-resistance decision made
  inside an agent run.
- **No lying security controls.** No code path may silently void a security
  control (a permission posture, a sandbox, an authentication check) while an
  operator-facing surface — status output, configuration display, documentation
  of enforced behavior — continues to report that control as enforced. When a
  path bypasses a control, the change MUST either remove or gate that path, or
  make every operator-facing surface report the real (bypassed) state. A
  bypass whose existence is only discoverable by reading source code violates
  this standard.
- **How propose and verify apply this.** Propose MUST classify the severity of
  any exposure a change addresses, enumerate its material requirements before
  writing tasks or close-claims, and carry every requirement as either an
  in-scope task or an explicit deferral meeting the rule above. Verify MUST
  treat each of the following as a failing defect: a close-claim on a security
  issue with any material requirement unimplemented or unverified; a security
  requirement absent from the change with no linked tracking issue, named
  owner, and recorded human sign-off; and any operator-facing surface that
  reports a security control as enforced while a shipped code path bypasses
  it.

## Applies to

Every change that touches security-relevant behavior — agent or command
execution seams, permission or sandbox posture, authentication/authorization,
secret or credential handling, audit trails and journals — and every change
whose source issue, plan, or manifest addresses an exposure classified severe
or high. For such changes, the full set of material requirements is in scope
by default; anything less requires the explicit deferral trail and honest
partial-close wording this standard defines.

## Implemented by

<!-- ratchet:implemented-by — generated from .ratchet/features/<capability>/.ratchet.yaml; do not edit by hand -->
