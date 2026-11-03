---
type: decision
id: KD-003
title: "Adopt review rule"
summary: "Changes get independent fresh-context review before commit; sub-agents never commit"
status: accepted
created: 2026-11-03T09:09:03
updated: 2026-11-03T09:09:03
tags: ["aislop"]
---

# KD-003: Adopt review rule

**Decision:** This project follows the `reviewing-work-units` skill for review scope, risk
classification, reviewer briefs, and stopping rules. The skill defines them. This record
does not restate them.

Applied here:

- A change to code, tests, or a plan gets an independent review in fresh context before
  commit. The brief names the baseline commit.
- Evidence gets independent review before it is used as an authoritative input to a
  correctness gate, even when no commit follows.
- Routine advisory inspection does not trigger acceptance review by itself.
- A HIGH-risk unit gets two reviewers in parallel with disjoint context. The brief
  declares the risk before work starts.
- A complete round with zero blockers ends review. Three blocked rounds trigger a
  reassessment, not a fourth rewrite by reflex.
- Sub-agents never commit. The orchestrator commits after review passes and stages files
  by name. `git add -A` and `git add .` are not used.
- Each round appends a row to the plan's review log.

**Status:** Accepted

**Rationale:** The project `AGENTS.md` already requires `pnpm typecheck && pnpm test &&
pnpm scan` before a change lands. Green checks did not catch the defects found in the hook
adapter plan: a test that would have fed a JSON array where an object was expected, an
uninstall path that could delete a user-authored file, a latency bound that did not hold
for multi-file edits. A fresh reader found each one. The rule makes that reader mandatory.

**Alternatives rejected:**
- Self-review by the writing agent. Rejected: the writer shares the blind spot that
  produced the defect.
- Review only at pull-request time. Rejected: the PR is too late for a plan defect, and
  review before each commit keeps the baseline for the next reviewer clean.

**Consequences:**
- Every work unit in a plan declares its risk and names its reviewer count.
- Reviewer findings are classified blocking, non-blocking, or trivia and recorded in the
  plan even when non-blocking.
- A unit blocked twice gets a design decision before a third attempt.

**Related:** KD-001, KD-002.
