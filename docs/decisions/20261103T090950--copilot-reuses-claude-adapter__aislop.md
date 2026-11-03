---
type: decision
id: KD-004
title: "Copilot reuses the Claude hook adapter"
summary: "The Copilot shared harness calls aislop hook claude; no copilot runtime adapter is written"
status: accepted
created: 2026-11-03T09:09:50
updated: 2026-11-03T09:09:50
tags: ["aislop", "hooks", "copilot"]
---

# KD-004: Copilot reuses the Claude hook adapter

**Decision:** The Copilot shared harness (VS Code 1.144.0 and later, Copilot CLI 1.0.105
and later) gets runtime feedback through the existing `runClaudeHook` and
`runClaudeStopHook` in `src/hooks/adapters/claude.ts`. The Copilot installer writes hook
files whose commands are `aislop hook claude` and `aislop hook claude --stop`. No
`src/hooks/adapters/copilot.ts` is written. The one adapter change is that `extractFiles`
accepts `tool_input.path` in addition to `tool_input.file_path`.

**Status:** Accepted

**Rationale:** Spike S1 on this machine showed that the Copilot harness, when given
PascalCase event names, sends the Claude-compatible snake_case payload
(`hook_event_name`, `tool_name`, `tool_input`, `cwd`, `stop_hook_active`). Fed the
captured payload with `path` renamed to `file_path`, the unchanged Claude adapter emitted a
complete feedback envelope. The only difference between the two hosts is that one key.
Evidence: `/tmp/opencode/aislop-spikes/s1/copilot-A-PostToolUse.json`,
`s1/e5-raw-stdout.txt` (0 bytes), `s1/e5-filepath-stdout.json` (1415 bytes, score 69).
These captures move to `tests/hooks/fixtures/` with the Copilot work unit.

**Alternatives rejected:**
- A separate `copilot.ts` adapter copied from `claude.ts`. Rejected: it duplicates about
  250 lines to handle one key, and the Stop logic would be a second derivation of the
  same gate.
- Support for the native camelCase payload (`toolName`, `toolArgs`). Rejected for the
  first version: the installer controls the event names, so the harness always sends
  snake_case. A hand-written camelCase hook file gets no feedback. Documented.

**Consequences:**
- Copilot scans report `agent: "claude"` in telemetry. Known gap, documented.
- Copilot hooks run only in a folder the user trusted (`--trust-folder` or the
  `trustedFolders` list). The installer's instructions block states this.
- A later Claude adapter change affects Copilot. The shared `buildHookGroup` matcher is
  pinned by both installer tests.

**Related:** KD-005. Plan: foundation.
