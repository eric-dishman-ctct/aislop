---
type: decision
id: KD-002
title: "Adopt evidence rule"
summary: "Claims about measurements cite the verbatim command and its actual captured output"
status: accepted
created: 2026-11-03T09:08:19
updated: 2026-11-03T09:08:19
tags: ["aislop"]
---

# KD-002: Adopt evidence rule

**Decision:** This project follows the measurement rules in the section "Measurements and
primary evidence" of the user-level guide `agent-config/user-AGENTS.md`. The installer
composes that guide into the pi and OpenCode user-level `AGENTS.md`.

The rules, as they apply here:

- A claim about a test result, score, count, or timing names the verbatim command and the
  capture file that holds its actual output, at the exact scope of the claim. A file-level
  run does not support a suite-level claim.
- A matching capture is reused instead of a rerun. A new run needs a stated reason: changed
  conditions, a requested current measurement, a required independent check, or a declared
  statistical sample.
- The orchestrator opens the capture and reads the number there. A number relayed through
  another agent's prose is not evidence.
- Historical evidence is labelled historical. It does not stand in for a requested current
  measurement.
- Output is quoted verbatim or labelled abridged.
- An explicit execution limit or a task-specific stop is kept. The rules above do not
  override it.

**Status:** Accepted

**Rationale:** The hook adapter plan for this project went through four review rounds. Two
blocking findings were claims written from summaries rather than from source or captures.
The spike evidence that finally held up was the evidence with a named fixture file for every
claim.

**Alternatives rejected:**
- Trust sub-agent reports as written. Rejected after round 3 found that one quoted number
  came from an unarchived ad hoc run.
- Rerun every measurement on demand. Rejected because it wastes budget and hides whether
  the earlier capture and the claim ever matched.

**Consequences:**
- Test runs are captured with `tee` into a named file and cited by path.
- Spike fixtures used by tests are copied into `tests/hooks/fixtures/` with their source
  capture named in the plan.
- Review briefs name the baseline commit so the reviewer can diff rather than infer.

**Related:** KD-001, KD-003.
