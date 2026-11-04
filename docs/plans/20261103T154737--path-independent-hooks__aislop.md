---
type: plan
title: "PATH-independent hook commands"
summary: "Make every aislop hook run without PATH lookup of aislop or node, per KD-007: install-time resolver, per-host command builders, run-time resolution in plugins, a temporary-install guard, and hook doctor"
status: in-progress
created: 2026-11-03T15:47:37
updated: 2026-11-04T08:35:46
tags: ["aislop", "hooks", "path"]
---

# PATH-independent hook commands

## Status

In progress. U1 committed as b47169d. Accepted revision 2 after two plan review rounds. Round 2 findings are folded in as C5. Decision [KD-007](../decisions/20261103T140509--hook-command-embeds-node-and-cli-paths__aislop.md)
accepted. No unit started. Baseline for all reviews: the commit that lands this plan.

## Context

Wave 1 ([foundation plan](20261103T091028--foundation__aislop.md), tag `wave-hooks-v1`)
shipped runtime hooks for six hosts. Every installer writes a command that depends on
`PATH` lookup of `aislop`, and through its shebang of `node`. In VS Code the hook `PATH`
lacks the nvm bin directory, so hooks are silent for nvm users while the Copilot CLI works
([R-001](../research/20261103T115650--vscode-copilot-hook-delivery__aislop.md),
[R-003](../research/20261103T132420--hook-command-environment-probes__aislop.md)).
[R-002](../research/20261103T130449--hook-command-binary-resolution__aislop.md) surveyed
the installers and precedents. KD-007 decides the shape. This plan implements it.

Facts the design rests on, each with a capture:
- Absolute `node` plus `cli.js` works in VS Code and the CLI, as a quoted string and as
  Copilot `exec` plus `args`, on real Edit and Stop events including a block-and-fix cycle
  (R-003).
- Copilot `env.PATH` does not expand `$PATH` (R-003).
- The `__aislop` sentinel is matched by key, never by hash (`src/hooks/io/json-patch.ts`),
  so a per-machine command string is safe for upsert and removal (R-002).
- `src/ui/invocation.ts:2` detects only an `_npx` execution path. bun, pnpm, and yarn cache
  detection is new in this plan.
- `upsertHookGroup` and `removeAislopEntries` match the `__aislop` key and never read
  `command`, so a Copilot entry with `exec` and `args` and no `command` is handled
  (`src/hooks/io/json-patch.ts`).
- The Claude, Cursor, and Gemini adapters exit 0 with no scan when the payload resolves no
  file (`src/hooks/adapters/claude.ts:104-107`). A doctor probe cannot use a plain
  PostToolUse payload as a health signal.
- The VS Code Copilot runtime loads hook files at process start. A full quit is needed
  after install (R-003).

Binding decisions: KD-001 to KD-003 (conventions, evidence, review),
[KD-004](../decisions/20261103T090950--copilot-reuses-claude-adapter__aislop.md) (Copilot
runs `hook claude`), [KD-006](../decisions/20261103T121350--fork-does-not-contribute-upstream__aislop.md)
(no upstream PR), KD-007 (this design).

Out of scope: Windows verification on a real Windows host. Builders are unit-tested and
labelled unverified until a Windows probe exists. A tool-owned launcher script, rejected
in KD-007.

## Phases

### Phase 1: resolver and temporary-install guard (U1)

Risk: MEDIUM. One worker, one execution reviewer. Consequence of a defect: a wrong path
written into every hook, or a durable hook pointing into an npx cache.

- [x] `src/hooks/runtime/resolve.ts`: `resolveHookRuntime()` returns `{nodePath, cliPath, version}` from `process.execPath` and `import.meta.url` of the running CLI, with `fs.realpathSync` applied to both ([u1-gates](../evidence/20261103-u1-gates.md))
- [x] `isTemporaryExecution(cliPath)` detects `_npx`, `.bun/install/cache`, `pnpm/dlx`, `.yarn/$$` style cache paths ([u1-gates](../evidence/20261103-u1-gates.md))
- [x] Reuse `src/ui/invocation.ts` logic and move it here ([u1-gates](../evidence/20261103-u1-gates.md))
- [x] Runtime file `hook-runtime.json` with `{schema: 1, nodePath, cliPath, version, writtenAt}`. Global scope writes `~/.aislop/hook-runtime.json`. Project scope writes `.aislop/hook-runtime.json`. Readers prefer the project file, then the global file ([u1-gates](../evidence/20261103-u1-gates.md))
- [x] `readHookRuntime(dir)` validates `schema === 1`, string paths, and that both paths exist on disk. A failed check returns `{status: "missing" | "invalid" | "stale", ...}` and never throws ([u1-gates](../evidence/20261103-u1-gates.md))
- [x] `hook install --project` prints a reminder that `.aislop/hook-runtime.json` holds machine paths. `aislop init` adds it, `session.jsonl`, and lock files to the generated `.gitignore` snippet ([u1-gates](../evidence/20261103-u1-gates.md))
- [x] `hook install` refuses with exit 1 and a stable-install hint when `isTemporaryExecution` is true and the install would persist any absolute path: an absolute command string, an `exec` entry, or a runtime file. Plugin installs count, because the runtime file is durable ([u1-gates](../evidence/20261103-u1-gates.md))
- [x] `--force-temporary` overrides with a warning on stderr ([u1-gates](../evidence/20261103-u1-gates.md))
- [x] Per-host command builders in `src/hooks/runtime/command.ts`: `posixQuoted(node, cli, args)`, `powerShellQuoted(...)`, `copilotExec(node, cli, args)`. Each handles spaces, backslashes, single and double quotes. No `cmd.exe` builder, because no installer targets `cmd.exe` ([u1-gates](../evidence/20261103-u1-gates.md))
- [x] `selectShellBuilder(platform)` returns the POSIX builder on Linux and macOS and the PowerShell builder on `win32` ([u1-gates](../evidence/20261103-u1-gates.md))
- [x] `aislop hook runtime [--json]` prints the resolved pair and the temporary flag, for the built-CLI test and for doctor ([u1-gates](../evidence/20261103-u1-gates.md))
- [x] Built-CLI test: run `node dist/cli.js hook runtime --json` after `pnpm build` and assert `cliPath` ends with `dist/cli.js` and equals its realpath. A second case runs through a symlink that imitates a global install and asserts the realpath, not the symlink ([u1-gates](../evidence/20261103-u1-gates.md))
- [x] Tests red-first for every Mechanisms row marked U1, `Test` column added ([u1-gates](../evidence/20261103-u1-gates.md))
- [x] Gates captured: [u1-gates](../evidence/20261103-u1-gates.md)
- [x] Independent review PASS (round 2, zero findings) ([u1-gates](../evidence/20261103-u1-gates.md))
- [x] Commit b47169d

### Phase 2: shell-string installers (U2)

Risk: MEDIUM. One worker, one execution reviewer. Consequence of a defect: a hook that
never runs, or a committed project file that breaks teammates.

- [ ] `HookInstallOpts` gains `absolute: boolean`. Default: `true` for global scope, `false` for project scope. CLI flag `--absolute` forces `true` for project scope and prints a do-not-commit reminder
- [ ] Upgrade behaviour: a global reinstall rewrites an existing portable global entry to the absolute form and says so in the install summary. Docs state that `hook install` after a Node or aislop upgrade rewrites global hooks
- [ ] Claude: `buildHookGroup`, `buildStopHookGroup`, file-changed group take a command builder. Portable form unchanged. Absolute form uses the POSIX builder on Linux and macOS, PowerShell builder on Windows
- [ ] Cursor and Gemini: same change with their builders and hash bodies
- [ ] Copilot: absolute form writes `exec` plus `args` entries. Portable form unchanged. Shared builders with Claude keep one matcher
- [ ] Sentinel hash body includes the written command. Upsert and removal unchanged (key match)
- [ ] Existing literal-command tests change to structural assertions plus a portable-form literal check. The Copilot fixture-equality test compares the portable form only and stays byte-anchored to `tests/hooks/fixtures/copilot-B-hookfile.json`
- [ ] New Copilot test: the absolute form keeps the accepted structure from the fixture (same event keys, same matcher `Edit|Write|MultiEdit`, same `__aislop` sentinel placement) and differs only in `exec` and `args` replacing `command`
- [ ] Docs: README and `docs/commands.md` explain global absolute default, project portable default, `--absolute`, the VS Code full-quit note, and the nvm cause
- [ ] Tests red-first for every Mechanisms row marked U2, `Test` column added
- [ ] Gates captured
- [ ] Independent review PASS
- [x] Commit b47169d

### Phase 3: plugin installers (U3)

Risk: LOW. One worker, one execution reviewer. Consequence of a defect: a plugin that
spawns the wrong binary or falls through to `PATH` silently.

- [ ] Generated pi extension and OpenCode plugin resolve at run time: `AISLOP_BIN` as an executable branch with `["hook", agent]` args, else `hook-runtime.json` pair as `spawn(nodePath, [cliPath, "hook", agent])`, else `spawn("aislop", ["hook", agent])`
- [ ] Plugins read the runtime file in the same order: project `.aislop/hook-runtime.json` under the host's project directory, then `~/.aislop/hook-runtime.json`. The generated source inlines the same validation (schema, string paths, existence), because the plugin cannot import aislop
- [ ] A `missing`, `invalid`, or `stale` result falls through to bare `aislop`. No branch throws
- [ ] A `stale` result delivers one line `aislop: hook runtime stale, run aislop hook install` to the model even when the fallback spawn fails or prints nothing. The stale line is assembled before the spawn result is inspected, not inside the success path (`src/hooks/install/pi.ts:80-89`, `src/hooks/install/opencode.ts:84-96` return early today). Tests cover: stale plus failed fallback, stale plus empty feedback, stale plus normal feedback
- [ ] A missing or unparsable file falls through
- [ ] Executed-plugin tests drive all three branches plus the stale case with injected spawn and a temp filesystem
- [ ] The pi extension test gains a discriminating assertion on `event.input.path` extraction (foundation C13)
- [ ] Tests red-first for every Mechanisms row marked U3, `Test` column added
- [ ] Gates captured
- [ ] Independent review PASS
- [x] Commit b47169d

### Phase 4: hook doctor (U4)

Risk: MEDIUM. One worker, one execution reviewer. Consequence of a defect: doctor reports
healthy for a hook that does not run.

- [ ] Adapter probe mode: every `aislop hook <agent>` subcommand accepts `--doctor-probe`. It prints `{schema: "aislop.hook.probe.v1", version, nodePath, cliPath}` to stdout and exits 0. It reads no stdin, opens no lock, and writes no baseline or session file
- [ ] CLI startup skips `fireInstalledOnce` and every other pre-parse write (`src/cli.ts:252-253`, `src/telemetry/identity.ts:30-34`) when `--doctor-probe` is in `argv`. Test: telemetry enabled, fresh temp HOME, run the probe, assert HOME tree unchanged
- [ ] `aislop hook doctor`: for every detected agent and scope, read each managed entry, take its command exactly as written (`command` string through the platform shell, or `exec` plus `args` without a shell), append `--doctor-probe`, run with a 10 s timeout, and report per entry: started (process ran), delivered (probe JSON parsed), version, nodePath and cliPath exist, stale versus the runtime file
- [ ] Doctor runs each managed entry once per event group (PostToolUse, Stop, FileChanged), so a broken Stop command gets its own line
- [ ] Plugin hosts: doctor loads the generated file in-process with the same loader the executed-plugin tests use, registers it against a fake host, drives the hook with one synthetic edit event, and injects a runner that appends `--doctor-probe` to whatever the handler spawns. The host process is not started. The report says delivered only when the handler produced the probe JSON through its own code path. This executes every managed hook per KD-007 item 6, including the handler code, not only the command it would pick
- [ ] `hook install` on a host with a stale absolute command rewrites it
- [ ] `hook status` shows a stale marker
- [ ] Docs: `docs/commands.md` doctor section, troubleshooting order: `hook doctor`, then `hook install`, then quit and relaunch the host
- [ ] Tests red-first for every Mechanisms row marked U4, `Test` column added
- [ ] Gates captured
- [ ] Independent review PASS
- [x] Commit b47169d

### Phase 5: integration

Risk: LOW. Orchestrator runs existing tools and live checks.

- [ ] Live: `hook install --copilot --global --quality-gate` on this machine with the installer-written file and no probe wrapper, VS Code full quit, one regression edit. Observable block: the transcript shows the aislop block reason and a second edit. Observable fix: `aislop scan` on the file reports no regression. Capture named
- [ ] Live: same with `--project` default (portable) and with `--project --absolute`, confirm the written command strings
- [ ] Live: `pnpm pack` to a tarball, then `npx --yes ./aislop-<version>.tgz hook install --claude --global` in a clean temp HOME. Assert exit 1, the hint on stderr, and no file written. Capture named
- [ ] Live: OpenCode and pi plugins deliver feedback with the runtime file present and the nvm bin directory removed from the host `PATH`. Then rename the recorded Node path and confirm the stale line appears in the feedback
- [ ] Cross-seam: one builder change fails tests in every installer that uses it
- [ ] Tag `wave-hooks-v2`, push with `--follow-tags`

## Mechanisms

| Mechanism | Property that must hold | Literal value | Test |
| --- | --- | --- | --- |
| U1 resolver realpath | Both paths are canonical and exist | `fs.realpathSync` on `process.execPath` and the cli path | `runtime.test.ts`: resolver realpath |
| U1 temporary detection | Known cache paths are detected, normal paths are not | `_npx`, `.bun/install/cache`, `dlx`, yarn `$$` segments | `runtime.test.ts`: temporary detection |
| U1 install refusal | A temporary execution writes no absolute command and exits 1 | exit code 1, no file written | `runtime-install.test.ts`: install refusal |
| U1 force flag | `--force-temporary` writes anyway with a warning on stderr | warning text contains `temporary` | `runtime-install.test.ts`: force flag |
| U1 POSIX builder | Spaces and quotes in either path survive `sh -c` | round trip through `sh -c` yields the original argv | `runtime.test.ts`: POSIX builder |
| U1 PowerShell builder | Output starts with the call operator and quotes both paths | `& '...' '...'`, apostrophes doubled | `runtime.test.ts`: PowerShell builder |
| U1 Copilot exec builder | No shell string, `exec` is the node path, `args[0]` is the cli path | object shape | `runtime.test.ts`: Copilot exec builder |
| U1 builder selection | `win32` selects PowerShell, other platforms select POSIX | `selectShellBuilder` | `runtime.test.ts`: builder selection |
| U1 runtime file write | Global install writes the home file, project install writes the project file, both with schema 1 | two paths | `runtime.test.ts`: runtime file write |
| U1 runtime file read | Missing, invalid, and stale each return their status and never throw | three statuses | `runtime.test.ts`: runtime file read |
| U1 built-CLI resolution | `dist/cli.js` resolves to its own realpath, through a symlink too | built test | `runtime-built.test.ts`: built-CLI resolution |
| U2 scope default | Global absolute, project portable, unless `--absolute` | `opts.absolute` resolution table |
| U2 project reminder | `--absolute` with project scope prints the do-not-commit reminder | stderr text |
| U2 portable form unchanged | With `absolute: false` every installer emits the wave-1 literal | `aislop hook <agent>` |
| U2 Copilot exec entries | Absolute Copilot entries have `exec` and `args`, no `command` | key presence |
| U2 hash covers command | The sentinel hash changes when the written command changes | `sentinelHash` input |
| U2 upgrade rewrite | Global reinstall replaces a portable entry with the absolute one | file content after |
| U2 Copilot structure kept | Absolute entry differs from the fixture only in `exec` and `args` replacing `command` | structural diff |
| U3 branch order | `AISLOP_BIN`, then runtime file, then bare | three injected-spawn tests |
| U3 AISLOP_BIN args | The override is spawned with `["hook", agent]` only | argv shape |
| U3 runtime file spawn | `spawn(nodePath, [cliPath, "hook", agent])` | argv shape |
| U3 fall-through | Missing or malformed runtime file does not throw and reaches bare | no throw, bare spawn |
| U3 stale line | A stale runtime file reaches bare and delivers the stale line once, also when the fallback fails or is empty | message text in three cases |
| U3 pi path extraction | The extension reads `event.input.path`, not another key | foundation C13 |
| U4 probe mode is inert | `--doctor-probe` writes no baseline, session, lock, or telemetry identity file and reads no stdin | HOME and project trees unchanged |
| U4 probe execution | Doctor runs the entry as written, string through the shell or `exec` without one | injected runner receives the file's entry |
| U4 started versus delivered | A process that runs but prints no probe JSON is reported started, not delivered | two report fields |
| U4 plugin probe | Doctor drives the generated handler with a synthetic event and the probe reaches the runner through the handler | injected runner called by handler |
| U4 status marker | `hook status` shows a stale marker from the same check | status output |
| U4 stale detection | Missing nodePath or cliPath, or version mismatch, is reported stale | report field |
| U4 timeout | A hung hook is killed and reported | 10000 ms |
| U4 repair | Install over a stale absolute command rewrites it | file content after |

## Gates

| Gate | Criterion | Target | Measured | Status |
| --- | --- | --- | --- | --- |
| G1 | U1 Mechanisms rows with a reviewer-confirmed deletion-discriminating test | 11 of 11 | 11 of 11, [u1-gates](../evidence/20261103-u1-gates.md) | [x] |
| G2 | U2 rows with a reviewer-confirmed test | 7 of 7 | | [ ] |
| G3 | U3 rows with a reviewer-confirmed test | 6 of 6 | | [ ] |
| G4 | U4 rows with a reviewer-confirmed test | 8 of 8 | | [ ] |
| G5 | Full suite failures after each unit | 0 | | [ ] |
| G6 | Self-scan score versus `wave-hooks-v1` | >= 100, 0 warnings | | [ ] |
| G7 | Live VS Code block-and-fix with the installer-written global hook, no probe wrapper | yes | | [ ] |
| G8 | Live refusal under `npx` from a packed tarball, exit 1, no file written | yes | | [ ] |
| G9 | Builders labelled unverified on Windows in docs | present | | [ ] |

## Review log

| Unit | Round | Reviewer verdict | Blocking | Non-blocking | Date |
| --- | --- | --- | --- | --- | --- |
| design | 1 | ENDORSE WITH CHANGES, folded into KD-007 | 3 | 4 | 2026-11-03 |
| plan | 1 | BLOCK, all findings folded into revision 2 | 6 | 3 | 2026-11-03 |
| U1 | 1 | BLOCK: private preferred reader discarded with void, cliPath realpath not discriminated, five unpinned edge cases | 2 | 5 | 2026-11-03 |
| U1 | 2 | PASS, all eight round-1 survivors fail named tests, zero findings | 0 | 0 | 2026-11-03 |
| plan | 2 | BLOCK, three findings folded into the text and C5. Round cap reached, plan accepted by the user with C5 mandatory | 3 | 0 | 2026-11-03 |

## Carried findings

| # | Finding | Source | Folded into |
| - | --- | --- | --- |
| C1 | Windows builders unverified without a Windows host | KD-007 | G9, docs label |
| C2 | pi extension path extraction has no discriminating test (foundation C13) | wave 1 | U3 task and Mechanisms row |
| C5 | Plan round 2: plugin doctor must drive the handler code, stale line must survive failed or empty fallback, probe must skip pre-parse telemetry writes. Mandatory in U3 and U4 briefs | plan review 2 | Phase 3 and 4 tasks and rows |
| C4 | Plan round 1: runtime file location, plugin temporary guard, inert doctor probe, plugin doctor execution, stale path, built-CLI test | plan review 1 | Phase 1, 3, 4 tasks and rows |
| C3 | Copilot scans report telemetry agent `claude` (foundation C7) | wave 1 | Not in scope |

## Related

- [KD-007](../decisions/20261103T140509--hook-command-embeds-node-and-cli-paths__aislop.md)
- [R-001](../research/20261103T115650--vscode-copilot-hook-delivery__aislop.md),
  [R-002](../research/20261103T130449--hook-command-binary-resolution__aislop.md),
  [R-003](../research/20261103T132420--hook-command-environment-probes__aislop.md)
- [Foundation plan](20261103T091028--foundation__aislop.md), tag `wave-hooks-v1`
