#!/usr/bin/env bash
#
# Blocker-raising variant of the scripted agent (see agent.sh).
#
# On the first propose it raises a blocker (a real alignment question) instead
# of scaffolding, parking the step. Once an answer has been recorded, the engine
# re-spawns this agent with the answer folded into the instructions; on that
# resume it detects the answer and proceeds exactly like the happy-path agent.
# This makes the halt-and-resume path reproducible.
set -euo pipefail

instructions="$(cat)"

transition="$(printf '%s\n' "$instructions" | sed -n 's/.*ONE transition: \([A-Z]*\) .*/\1/p' | head -n1)"
report_line="$(printf '%s\n' "$instructions" | grep -m1 'ratchet batch report')"
batch="$(printf '%s\n' "$report_line" | sed -n 's/.*ratchet batch report \([^ ]*\) --change .*/\1/p')"
change="$(printf '%s\n' "$report_line" | sed -n 's/.*--change \([^ ]*\).*/\1/p')"
change_dir=".ratchet/changes/$change"

# The instructions builder emits an "Answer:" line only on a resume after a
# recorded answer. Its presence is our deterministic signal to proceed.
has_answer="$(printf '%s\n' "$instructions" | grep -c '^  Answer:' || true)"

if [ "$transition" = "PROPOSE" ] && [ "$has_answer" = "0" ]; then
  # First pass: halt for alignment instead of guessing.
  ratchet batch report "$batch" --change "$change" \
    --blocker 'cookie or header sessions? changes the whole API surface' >/dev/null
  exit 0
fi

# Resume (answer in context) or any later transition: behave like agent.sh.
case "$transition" in
  PROPOSE)
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
    ratchet batch report "$batch" --change "$change" --complete 'proposed after resolving the blocker' >/dev/null
    ;;
  APPLY)
    if [ -f "$change_dir/plan.md" ]; then
      sed -i.bak 's/^- \[ \]/- [x]/' "$change_dir/plan.md"
      rm -f "$change_dir/plan.md.bak"
    fi
    ratchet batch report "$batch" --change "$change" --complete 'implemented all planned tasks' >/dev/null
    ;;
  VERIFY)
    ratchet batch report "$batch" --change "$change" --complete 'verified against the feature scenarios' >/dev/null
    ;;
esac
