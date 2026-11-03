---
type: research
id: R-001
title: "VS Code Copilot session target reads the aislop hook file"
summary: "Q6 from the foundation plan: VS Code 1.144.0 fires PostToolUse and Stop from .github/hooks/aislop.json with the same payload as the Copilot CLI, but its hook process has a minimal PATH"
status: concluded
created: 2026-11-03T11:56:50
updated: 2026-11-03T14:04:56
tags: ["aislop", "hooks", "copilot", "vscode"]
---

# R-001: VS Code Copilot session target reads the aislop hook file

## Question

Does the VS Code Copilot session target (VS Code 1.144.0, shared Copilot harness) read
`.github/hooks/aislop.json` and honour folder trust the same way the Copilot CLI 1.0.105
does? This is open question Q6 in the
[foundation plan](../plans/20261103T091028--foundation__aislop.md). All earlier evidence
came from the CLI.

## Method

1. Fresh test repository at `/tmp/opencode/aislop-spikes/s1/repo`, trusted earlier by the
   CLI runs. Installed with the shipped installer:
   `aislop hook install --copilot --project --quality-gate`, then `aislop hook baseline`.
2. Replaced the hook command string with a logging wrapper that records argv, stdin, and
   stdout of every call to `/tmp/opencode/wu3-vscode-log.txt`, then calls the real binary.
3. The user opened the folder in VS Code 1.144.0, started a session in the Agents view with
   the Copilot target, and sent one prompt that adds `as any` and an empty catch block
   through the edit tool.
4. Read the log. Re-fed the captured stdin to the adapter from a normal shell. Reproduced
   the empty output with `env -i PATH=/usr/bin:/bin`.

Captures: [VS Code hook log](../evidence/20261103-q6-vscode-hook-log.txt), and for
comparison the [Copilot CLI hook log](../evidence/20261103-wu3-copilot-cli-hook-log.txt)
from the same repository and hook file. Paths are replaced with `<repo>` in both.

## Findings

- VS Code fired both hooks from `.github/hooks/aislop.json`. The user saw no trust prompt
  because the folder was already trusted.
- The `PostToolUse` payload is the same shape as the CLI payload: `hook_event_name`,
  `session_id`, `timestamp`, `cwd`, `tool_name: "Edit"`, `tool_input.path`,
  `tool_result`. The `Stop` payload carries `stop_hook_active: false`.
- Both callbacks returned 0 bytes in VS Code. The CLI run with the same hook file returned
  a full envelope for `PostToolUse` and `decision: "block"` for `Stop`, and Copilot CLI
  then fixed the findings before it stopped.
- Cause of the empty output: the VS Code hook process has a minimal `PATH`. The test
  wrapper runs `exec node ...`, and `node` lives under nvm in the user's home. With
  `PATH=/usr/bin:/bin` the wrapper fails with `node: not found`. The CLI inherited the
  full shell `PATH` (spike E6). Fed the captured VS Code stdin from a normal shell, the
  adapter returned score 58, baseline 100, `regressed: true`.

## Open sub-questions

- Does VS Code launched from a login shell (`code .`) inherit the shell `PATH`? The user
  launched from a terminal in this run and still got the minimal `PATH`, so the answer
  appears to be no, but one run is not a sweep.
- Does the global hook location `~/.copilot/hooks/aislop.json` behave the same in VS Code?
  Not tested.

## Correction (2026-11-03, later the same day)

[R-003](20261103T132420--hook-command-environment-probes__aislop.md) measured the VS Code
hook `PATH`. It is the full desktop-session `PATH`, not a minimal one. It lacks only the
nvm bin directory. The `node: not found` cause below stands. The word "minimal" in this
note is wrong in degree.

## Conclusion

Q6 is answered yes: one installer serves the Copilot CLI and the VS Code Copilot session
target. The hook file, event names, payload shape, and trust model are the same.

A separate deployment fact follows: the hook command must resolve `aislop` and `node` from
a minimal `PATH`. A user who installed Node through nvm and runs `aislop` from a user
directory gets silent hooks in VS Code and working hooks in the CLI.

**Confidence:** High for the Q6 answer, from one captured run with identical payloads.
Medium for the `PATH` cause, from one reproduction with a stripped environment.

## Impact on plan / decisions

- Foundation plan Phase 4 item "Manual check Q6" is complete. Gate G9 stands on the CLI
  log. VS Code adds the same events.
- New carried finding C14 in the plan: hook commands need a `PATH`-independent `aislop`.
  For this wave the docs state the symptom and the check. A later decision record should
  weigh writing an absolute binary path into the hook command against the per-machine hash
  and relocation cost.
- Stop rule from the plan does not trigger. VS Code support ships.
