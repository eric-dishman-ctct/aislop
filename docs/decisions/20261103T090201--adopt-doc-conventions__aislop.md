---
type: decision
id: KD-001
title: "Adopt doc conventions"
summary: "Plans, decisions, and research notes follow the project-docs-conventions skill"
status: accepted
created: 2026-11-03T09:02:01
updated: 2026-11-03T09:02:01
tags: ["aislop"]
---

# KD-001: Adopt doc conventions

**Decision:** This project uses the naming, front-matter, and directory rules of the
`project-docs-conventions` skill for `docs/plans/`, `docs/decisions/`, and
`docs/research/`. The skill defines the rules. This record does not restate them.

**Status:** Accepted

**Rationale:** Fresh-context sub-agents read these documents to align with work they did
not see. One convention keeps the documents findable and auditable with `audit-docs.sh`.

**Alternatives rejected:**
- Free-form markdown under `docs/`, as the existing `docs/plans/fix-to-pr.md` uses. No
  front matter, so no audit and no index.
- GitHub issues as the only record. Not visible to an agent that reads the checkout.

**Consequences:**
- New plans, decisions, and research notes are scaffolded with `newdoc.sh`.
- `audit-docs.sh --repo .` runs before every commit that touches `docs/`.
- `docs/README.md` is generated with `make-index.sh`, not edited by hand.
- The upstream design spec `docs/plans/fix-to-pr.md` moves to `docs/fix-to-pr.md`, next
  to the other design documents. It is a specification, not a plan in this system, and
  it fails the audit where it was.

**Related:** `AGENTS.md`, section "Project documentation".
