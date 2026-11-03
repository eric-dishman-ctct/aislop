---
type: decision
id: KD-005
title: "Quality gate covers tool-observed edits only"
summary: "The Stop gate rescans files recorded by Edit, Write, and MultiEdit calls; shell edits to unrecorded files are not seen"
status: accepted
created: 2026-11-03T09:09:51
updated: 2026-11-03T09:09:51
tags: ["aislop", "hooks", "quality-gate"]
---

# KD-005: Quality gate covers tool-observed edits only

**Decision:** The `--quality-gate` Stop hook ships for Copilot with the same scope it has
for Claude Code. The gate rescans the files that `PostToolUse` recorded from `Edit`,
`Write`, and `MultiEdit` calls, using their current contents at Stop time. An edit made
through the shell tool to a file that was never recorded is not seen. An edit made through
the shell tool to a file that was recorded earlier is seen, because the rescan reads the
current file. Records live in `.aislop/session.jsonl`, are project-wide, carry no session
id, and persist until a Stop with no regression clears them. The CLI help text, the
instructions block, README, and `docs/commands.md` state these limits.

**Status:** Accepted by the user on 2026-10-30 after plan review round 3.

**Rationale:** The spike regression run used a shell append. No `PostToolUse` fired, no
file was recorded, and `runClaudeStopHook` returned without a scan
(`src/hooks/adapters/claude.ts:194-205`). This is how Claude Code behaves today. Changing
the gate to cover shell edits means either hooking the shell tool, which would scan on
every command, or diffing the tree at Stop, which is a different mechanism with its own
plan. Neither belongs in the Copilot unit.

**Alternatives rejected:**
- Drop `--quality-gate` for Copilot in the first version. Rejected: the gate works for the
  common case, and the limitation is identical to the shipped Claude Code behaviour.
- Hook `Bash` or `shell` tool calls and scan the whole project. Rejected: cost on every
  command, and the file list is unknowable from a shell string.
- Tree diff at Stop against the baseline commit. Deferred: a candidate for a later plan.

**Consequences:**
- Help text for `--quality-gate` reads: "Claude and Copilot. Covers Edit, Write, and
  MultiEdit tool calls only, not shell edits."
- Two tests pin the semantics: a Stop with an empty record list returns no decision, and a
  Stop after a recorded file changed outside the hook does scan it.
- OpenCode has no stop event in its v2 hook list, so `--quality-gate` with `--opencode`
  is rejected before any write.

**Related:** KD-004. Plan: foundation.
