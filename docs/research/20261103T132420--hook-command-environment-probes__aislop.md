---
type: research
id: R-003
title: "Hook command environment probes: absolute node and cli paths work in VS Code"
summary: "Live probes in Copilot CLI and VS Code 1.144.0 answer the open questions from R-002: VS Code lacks only the nvm bin directory, absolute node plus cli.js works in both hosts and both command forms, env.PATH does not expand, and VS Code loads hook files at runtime start"
status: concluded
created: 2026-11-03T13:24:20
updated: 2026-11-03T13:24:20
tags: ["aislop", "hooks", "path", "copilot", "vscode"]
---

# R-003: Hook command environment probes: absolute node and cli paths work in VS Code

## Question

[R-002](20261103T130449--hook-command-binary-resolution__aislop.md) left open: what
exactly is the VS Code hook environment, does an absolute `node` plus `cli.js` command work
there, does the Copilot shell-free `exec` plus `args` form work, and does the hook `env`
map expand `$PATH`? The design reviewer asked for these probes before a decision record.

## Method

Probe repository `/tmp/opencode/aislop-spikes/s1/repo`, trusted. A hook file with several
command entries side by side, each wrapped by a logging script that records stdin, stdout,
exit code, and the tool name. An environment dump script records the shell, parent
process, `PATH`, `SHELL`, `command -v node`, `/usr/bin/env`, and `NVM_*` variables.
Runs: Copilot CLI 1.0.105 with `copilot --trust-folder -p`, and VS Code 1.144.0 Agents
view with the Copilot target, user at the keyboard, four runs. The nvm shim was removed
from the CLI `PATH` for the command-form run so the CLI matched a plain nvm user.
Captures: [r003-probes](../evidence/20261103-r003-probes.md).

## Findings

VS Code hook environment:
- Shell `/bin/sh`. Parent is `copilot-runtime` under `/usr/share/code/...`.
- `PATH` is the user's desktop-session `PATH`: `~/.local/bin`, pyenv, go, cargo, system
  directories, a VS Code ripgrep directory. It is **not** minimal. It lacks exactly the
  nvm bin directory, because nvm adds that in interactive shell init. `NVM_DIR` is set.
  `command -v node` finds nothing. `/usr/bin/env` exists.
- This corrects [R-001](20261103T115650--vscode-copilot-hook-delivery__aislop.md), which
  called the `PATH` minimal. The CLI `PATH` included the nvm directory because the terminal
  shell had run nvm init.

Command forms, Edit event, measured in both hosts:

| Form | Copilot CLI | VS Code |
| --- | --- | --- |
| bare `aislop hook claude` | exit 127, `aislop: not found` | exit 127, `aislop: not found` |
| quoted `"<node>" "<cli.js>" hook claude` | 1820 bytes, score 58, regressed | 1820 bytes, score 58, regressed |
| `exec: <node>`, `args: [<cli.js>, hook, claude]` | 1820 bytes | 1820 bytes |
| `aislop hook claude` with `env.PATH: "<dir>:$PATH"` | `PATH` becomes the literal string with `$PATH` unexpanded, command fails | not tested |
| `aislop hook claude` with `env.PATH: "<dir>:/usr/bin:/bin"` | literal applied, works | not tested |

Both `bash:` and `command:` entry keys ran under `/bin/sh` with the same environment.

Hook file loading in VS Code:
- The Copilot runtime reads hook files when its process starts. Two file changes on disk
  were not picked up by a running runtime. "Developer: Reload Window" did not restart the
  runtime process (same PID before and after). A full VS Code quit and relaunch did.
- The runtime log records `Failed to reload managed hooks ... no hook session` at each
  file change.

Full quality-gate loop in VS Code, after a full restart, with the matcher and Stop entries
in the `exec` form:
1. 14:01:39 `PostToolUse` on Edit: score 58, baseline 100, `regressed: true`.
2. 14:01:50 `Stop`, `stop_hook_active: false`: adapter returned `decision: "block"`.
3. VS Code honoured the block. The agent edited again.
4. 14:02:41 `PostToolUse` on Edit: score 100, `regressed: false`. The `as any` cast and
   the empty catch were replaced with a typed optional call.
5. 14:02:57 `Stop`, `stop_hook_active: true`: adapter returned nothing. Session ended.

## Open sub-questions

- Windows: PowerShell invocation of a quoted absolute path, and the `exec` form on
  Windows. Not probed. No Windows host in this session.
- Claude Code desktop, Cursor, Gemini: the same absolute form is expected to work under
  any POSIX shell, but only the Copilot hosts were probed.
- Whether `exec` plus `args` is honoured by the VS Code hook schema validator for files
  written by the installer with the `__aislop` sentinel. The probe file carried no sentinel.

## Conclusion

The failure is nvm-specific, not a minimal `PATH`. Any absolute `node` plus absolute
`cli.js` command works in both Copilot hosts, in the quoted shell form and in the
shell-free `exec` form. `env.PATH` cannot carry `$PATH`, so it is not a general fix. VS Code
needs a full restart to load a changed hook file.

**Confidence:** High for Copilot CLI and VS Code on Linux, from direct captures with stdin
and stdout per call. Not measured on Windows or in Claude, Cursor, Gemini.

## Impact on plan / decisions

- Grounds the next decision record on the hook command shape. The `exec` plus `args` form
  is the preferred Copilot shape because it needs no shell quoting. The quoted form is the
  fallback for hosts that only accept a command string.
- Docs: after `aislop hook install`, quit and relaunch VS Code. A window reload is not
  enough. Joins the OpenCode restart note (C12).
- R-001 gets a correction note pointing here.
