#!/usr/bin/env bash
#
# Deterministic scripted "coding agent" for the batch engine eval.
#
# The batch engine sets RATCHET_BATCH_AGENT_CMD to this script and runs it via
# `bash -c`, feeding the step instructions on stdin. We stand in for a real
# coding agent: we read the instructions, learn which transition we are being
# asked to perform and for which batch/change, drive that one transition for
# real (scaffolding the change on propose, checking task boxes on apply,
# confirming on verify), and report the outcome through `ratchet batch report`
# exactly as a real agent would. cwd is the batch project root.
#
# This makes the propose -> apply -> verify sequence reproducible so the eval
# can assert observable batch state instead of spawning an LLM.
set -euo pipefail

instructions="$(cat)"

# The instructions name the transition ("Perform EXACTLY ONE transition: PROPOSE
# for change "<c>".") and carry the report-channel command line, from which we
# read the batch and change deterministically.
transition="$(printf '%s\n' "$instructions" | sed -n 's/.*ONE transition: \([A-Z]*\) .*/\1/p' | head -n1)"
report_line="$(printf '%s\n' "$instructions" | grep -m1 'ratchet batch report')"
batch="$(printf '%s\n' "$report_line" | sed -n 's/.*ratchet batch report \([^ ]*\) --change .*/\1/p')"
change="$(printf '%s\n' "$report_line" | sed -n 's/.*--change \([^ ]*\).*/\1/p')"

change_dir=".ratchet/changes/$change"

case "$transition" in
  PROPOSE)
    # Scaffold a minimal change directory: a plan with a ## Tasks checkbox and a
    # features/ dir, so the change now "exists" with a plan (the engine derives
    # apply as the next transition from this on-disk state).
    mkdir -p "$change_dir/features"
    printf '%s\n' \
      "# $change" \
      '' \
      '## Tasks' \
      '' \
      '- [ ] 1.1 Implement the login endpoint' > "$change_dir/plan.md"
    printf '%s\n' \
      "Feature: $change" \
      '  Scenario: the endpoint responds' \
      '    Given the API is up' \
      '    Then a login request succeeds' > "$change_dir/features/login.feature"
    ratchet batch report "$batch" --change "$change" --complete 'proposed the change scaffold' >/dev/null
    ;;
  APPLY)
    # Implement: check every task box in the plan done.
    if [ -f "$change_dir/plan.md" ]; then
      sed -i.bak 's/^- \[ \]/- [x]/' "$change_dir/plan.md"
      rm -f "$change_dir/plan.md.bak"
    fi
    ratchet batch report "$batch" --change "$change" --complete 'implemented all planned tasks' >/dev/null
    ;;
  VERIFY)
    # Verify: the proof-of-work passes; report completion of the verify step.
    ratchet batch report "$batch" --change "$change" --complete 'verified against the feature scenarios' >/dev/null
    ;;
  *)
    echo "scripted agent: could not determine transition from instructions" >&2
    exit 1
    ;;
esac
