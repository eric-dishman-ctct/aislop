---
type: research
id: R-002
title: "How aislop hook commands find the binary, and what each host gives them"
summary: "Survey of the six installers' command strings, the sentinel hash, host hook environments, and precedents from husky and pre-commit, to ground a decision on PATH-independent hook commands"
status: concluded
created: 2026-11-03T13:04:49
updated: 2026-11-03T13:04:49
tags: ["aislop", "hooks", "path"]
---

# R-002: How aislop hook commands find the binary, and what each host gives them

## Question

[R-001](20261103T115650--vscode-copilot-hook-delivery__aislop.md) found that the VS Code
Copilot hook process runs with a minimal `PATH`, so `aislop hook claude` can fail to start
while the same hook file works from the Copilot CLI. Before a decision on the fix: how does
each installer resolve the binary today, what does each host provide, and what do other
hook-installing tools do?

## Method

Two parallel sub-agent surveys on 2026-11-03. A scout read the installers, the sentinel
code, the CLI launch path, and the subprocess helpers in this repository at
`wave-hooks-v1`. A researcher read the official hook references for the six hosts, the
Node `child_process` docs, the VS Code terminal environment docs, and the husky and
pre-commit sources. The researcher's search-verification provider failed, so it read the
pages directly. Inferences are marked.

## Findings

### Installers in this repository

| Installer | What the host runs | Binary resolution | Identity for upsert and removal |
| --- | --- | --- | --- |
| Claude (`install/claude.ts:32-90`) | Shell string `aislop hook claude`, `--on-file-changed`, `--stop` | `PATH` lookup | `__aislop` key. Hash covers command and matcher |
| Cursor (`install/cursor.ts:30-40`) | Shell string `aislop hook cursor` | `PATH` lookup | `__aislop` key. Hash covers command and timeout |
| Gemini (`install/gemini.ts:31-48`) | Shell string `aislop hook gemini` | `PATH` lookup | `__aislop` key. Hash covers command and matcher |
| Copilot (`install/copilot.ts:4-6,52-54`) | Same strings as Claude, via the shared builders | `PATH` lookup | Same as Claude |
| pi (`install/pi.ts:31-33,64-80`) | In-process JS. Extension spawns `process.env.AISLOP_BIN \|\| "aislop"` | Env override, else `PATH` | File path and header marker. No command hash |
| OpenCode (`install/opencode.ts:25-40,83-89`) | In-process JS. Plugin spawns `process.env.AISLOP_BIN \|\| "aislop"` | Env override, else `PATH` | File path and header marker. No command hash |

- The `__aislop` sentinel is what upsert and removal match on (`io/json-patch.ts:3-65`).
  The hash inside it is recorded but never compared. A per-machine command string would
  change the hash without breaking idempotence or removal.
- No installer sets `AISLOP_BIN`. The two plugin installers accept it but rely on `PATH`
  by default, so they have the same exposure as the shell-string installers.
- The CLI is `dist/cli.js` with `#!/usr/bin/env node` (`package.json:6-10`). The README
  recommends `npm install -g aislop`. No helper knows the absolute path of the running CLI.
  `process.argv[1]` is used in `src/commands/agent-local-cli.ts:7-18` with a `dist/cli.js`
  fallback. `src/utils/tooling.ts:43-82` resolves bundled external tools and scans `PATH`
  with `.exe` on Windows. Nothing under `src/hooks/` handles Windows `.cmd` shims or
  quoting.

### Host hook environments

| Host | Shell | `PATH` source | Notes |
| --- | --- | --- | --- |
| Copilot CLI and VS Code Copilot | `bash` on Unix, `powershell` on Windows, `command` as fallback. The CLI also supports shell-free `exec` plus `args` | CLI: the launching shell. VS Code: observed minimal (R-001) | Hook `env` map can set `PATH`. `COPILOT_HOME` moves only the hook directory |
| Claude Code | A shell command. The reference names no single shell | The launching CLI, desktop app, or IDE | `$CLAUDE_PROJECT_DIR` is available. Docs show absolute paths and explicit `powershell.exe -File` on Windows |
| Cursor | A shell command | Not documented. Inference: desktop process env | Windows runs hooks through PowerShell |
| Gemini CLI | A shell command | Sanitized environment, contents not published | `GEMINI_PROJECT_DIR`, `GEMINI_CWD`, alias `CLAUDE_PROJECT_DIR` |
| OpenCode v2 plugin | None. `child_process.spawn` without a shell | `options.env.PATH` else `process.env.PATH` of the server. Inference: a launcher-started server has the launcher's `PATH` | Windows `.cmd` shims need a shell or `cmd.exe` |
| VS Code itself | Integrated terminal resolves the login shell env on macOS. `terminal.integrated.inheritEnv` controls it | No documented promise that extension-host children get the resolved env | R-001 observed `/usr/bin:/bin` style `PATH` for the hook process |

### Precedents

- husky writes `#!/usr/bin/env sh` stubs and documents the GUI failure mode: version
  managers change only the interactive shell `PATH`. Its answer is a user file
  `~/.config/husky/init.sh` sourced before each hook.
- pre-commit embeds the installing Python's `sys.executable` into the generated hook and
  owns isolated environments. On Windows it writes `/bin/sh` because `bash` may be absent.
- The general trade: an absolute path fixes lookup and breaks on relocation, reinstall, or
  a version-manager switch. A tool-owned launcher or an explicit `env.PATH` avoids both.

## Open sub-questions

- Does the Copilot hook `env` map accept a `PATH` value with `$PATH` expansion on both
  platforms? The reference says expansion is supported. Not tested here.
- Does Claude Code desktop on macOS, started from the dock, have the same minimal `PATH`
  as VS Code? Likely yes by the same mechanism. Not tested.
- What does `process.execPath` return for an `npm -g` install under nvm, and does it stay
  valid after `nvm use` changes the default? Needs a probe before any absolute-path design.

## Conclusion

All six installers depend on `PATH` by default. The sentinel design does not depend on the
command string, so changing the string per machine is safe for upsert and removal. The
hosts differ: Copilot offers a shell-free `exec` form and an `env` map, Claude and Gemini
give project-directory variables, OpenCode and pi run JS and can compute a path at runtime.
No single string works everywhere. A design that resolves the binary at install time and
writes it in the host's native form, with a documented repair path when it goes stale, is
the shape that fits every host. The pre-commit precedent supports it. The husky precedent
warns about version managers.

**Confidence:** High for the repository facts. Medium for host behaviour, since Cursor and
Gemini do not document `PATH` and the OpenCode launcher case is inferred.

## Impact on plan / decisions

- Grounds the next decision record on the hook command shape. Candidates: (a) absolute path of the `aislop`
  launcher found at install time, (b) `node <absolute dist/cli.js>` from `process.execPath`
  and `import.meta.url`, (c) a tool-owned launcher script written next to the hook file,
  (d) Copilot `env.PATH` plus `exec`. One decision covers all six installers.
- Any choice needs a `hook doctor` style check that reports a stale path, and a reinstall
  path. The sentinel hash change is harmless.
- The existing plugin installers should set `AISLOP_BIN` from the same resolver so pi and
  OpenCode stop depending on `PATH` too.
- Carried finding C14 in the foundation plan points here.
