---
type: decision
id: KD-006
title: "The fork pulls from upstream and does not contribute back"
summary: "eric-dishman-ctct/aislop tracks scanaislop/aislop develop as a pull-only source, and no pull requests go upstream"
status: accepted
created: 2026-11-03T12:13:50
updated: 2026-11-03T12:13:50
tags: ["aislop", "workflow"]
---

# KD-006: The fork pulls from upstream and does not contribute back

**Decision:** The fork `eric-dishman-ctct/aislop` is the deliverable. Work lands on branches
in the fork and merges into the fork's `develop`. The fork merges upstream `scanaislop/aislop`
`develop` when useful. No pull request is opened against upstream from this
fork.

**Status:** Accepted. The user decided this on 2026-11-03.

**Rationale:** The user does this work under a corporate AI account. The user does not expect
to be able to contribute it back under upstream's terms. Pulling improvements in carries
no such constraint.

**Alternatives rejected:**
- Draft PRs to upstream `develop`, as the upstream `AGENTS.md` instructs. Rejected for the
  reason above. The upstream instruction stays in `AGENTS.md` for context, with a note in
  the fork's "Project documentation" section that this decision overrides it.
- A clean-room reimplementation outside the fork. Rejected: the hook pipeline is the
  value, and the fork keeps upstream fixes flowing in.

**Consequences:**
- This record cancels the Phase 4 task "Draft PR to scanaislop/aislop develop" in the
  foundation plan.
- The orchestrator tags wave boundaries and pushes them to the fork only.
- Periodic `git merge origin/develop` into the fork's working branch replaces the PR
  cycle. Conflicts in `src/hooks/` are likely. The fork resolves them.
- `AGENTS.md` gains one line pointing at this decision.

**Related:** Foundation plan Phase 4.
