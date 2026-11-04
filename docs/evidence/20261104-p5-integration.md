# Phase 5 integration: PATH-independent hooks (wave-hooks-v2)

Branch feat/copilot-opencode-hooks at ea9792c, built CLI aislop 0.20.0. Commands ran through
`npx --yes pnpm` or `node dist/cli.js` because pnpm and aislop were not on PATH.

## Item 1, live VS Code block-and-fix (G7)

Host: VS Code 1.144.0, Copilot agent view, model Claude Fable 5.1. Hook: the installer-written
file `~/.copilot/hooks/aislop.json` from `hook install --copilot --global --quality-gate`, no
probe wrapper, `exec` set to the nvm Node binary and `args` to `dist/cli.js hook claude`.
`hook doctor --global` before the run: both entries `started=true, delivered=true`, exit 0.

The user quit VS Code fully and relaunched from the desktop. A new copilot-runtime started
at 13:24:56 local. VS Code PATH lacks the nvm bin directory (R-003).

Run 1 and run 2 produced no block. Cause: the orchestrator deleted the spike repo
`.aislop/baseline.json`, and without a baseline the gate never reports `regressed`.
`hook install --quality-gate` does not capture a baseline (carried finding C13).

The hook itself fired in both runs: `.aislop/session.jsonl` recorded the edited file
56 s after the new runtime started. Run 1 also showed the test prompt scored 100 in the
spike config, so the prompt was changed.

Run 3, after `aislop hook baseline` (score 100): `.aislop/session.jsonl` recorded two
PostToolUse entries, 19:33:00Z and 19:34:40Z, both for `src/index.ts`. Between them the
Stop hook blocked.

Copilot's transcript, verbatim: "No Node runtime is on PATH, so I can't run the CLI
here; I'll check the rule sources directly" and then "I couldn't run the aislop CLI to
confirm the score (no Node runtime on PATH in this shell), so I verified against the rule
patterns ... Your hook's next pass should show it back at 100." The final file had no
`as any` and no empty catch, and `aislop scan` reported 98/100, 0 findings.

Result: G7 yes. The absolute-path hook runs in VS Code without nvm on PATH, the gate blocks,
and the agent fixes the code. The agent cannot run bare `aislop` in the VS Code shell
(carried finding C14).

Dry run from a normal shell with the same regression: PostToolUse score 69, baseline 100,
regressed true, Stop returned a block.

## Item 2, project installs

See `20261104-p5-item2.txt`. `--copilot --project` wrote `command: aislop hook claude`.
`--copilot --project --absolute` wrote `exec` and `args` with no `command` and printed
`Reminder: do not commit hook files with absolute machine paths.` on stderr.
`--claude --project --absolute` wrote the quoted POSIX string for PostToolUse and FileChanged.
`hook doctor --project`: three entries delivered, runtime pair matches, exit 0.
Note: the first attempt ran from the aislop repo cwd and installed into the repo. The
orchestrator reverted those files.

## Item 3, npx tarball refusal (G8)

See `20261104-p5-item3.txt`. `pnpm pack` produced `aislop-0.20.0.tgz`.
`npx --yes --package=<tgz> aislop hook install --claude --global --yes` in a clean HOME:
exit 1, stderr `Refusing to install hooks from a temporary package cache. Install aislop
stably, then run hook install again. Use --force-temporary to override.`, no hook file.
The refused path still wrote the telemetry identity `.aislop/install_id` (C12).
`--force-temporary` wrote a command into `.npm/_npx/...` with the warning, as designed.

## Item 4, OpenCode and pi without nvm on PATH

Historical: the U3 round 1 reviewer covered this live on OpenCode 2.2.5 and the pi harness,
including the forced-stale line. See `20261103-u3-gates.md`. Not rerun.

## Item 5, cross-seam mutations

See `20261104-p5-item5.txt`. In a scratch copy of HEAD, which the orchestrator restored byte-identical after each row:

| Mutation in `src/hooks/runtime/command.ts` | Failing test files |
| --- | --- |
| `posixQuoted` drops `cliPath` | install-claude, install-cursor, install-gemini, runtime (4 tests) |
| `copilotExec` swaps `exec` and `args[0]` | runtime only (1 test) |
| `selectShellBuilder` always POSIX | install-claude, runtime (2 tests) |

The Copilot installer seam is unpinned: `install-copilot.test.ts:65` checks `exec` is a
string, not the Node path (C11).

## Item 6, G9

README.md:294 and docs/commands.md:202 both say "Windows builders are unverified."

## Phase 6, U5 live VS Code rerun (G11)

Same host and hook file as item 1, rebuilt `dist/cli.js` with U5, baseline 100, same
regression prompt. `.aislop/session.jsonl` recorded hook hits at 14:20:55 and 14:21:28
local, with the Stop block between them. Copilot's transcript: "Found the hook's node and
CLI paths. The verify_fix command resolves to `<node> <cli.js> scan --changes`. First,
confirm the two findings on the current file, then fix." It ran the absolute command
(tool line "Run verify_fix command to list current findings"), confirmed the two findings,
edited, and finished. The transcript has no "cannot run", "not on PATH", or "can't run the
CLI" statement. The final file scans 98/100 with 0 findings.

Replay of the Stop block from a shell with the absolute launch: reason
`aislop: score dropped from 100 to 69. Fix the 2 findings before finishing. Use the
verify_fix command in suggestedActions; do not run bare aislop, it may not be on PATH
here.` and `verify_fix` command `'<node>' '<cli.js>' scan --changes`.

Observation, not a finding: before it read the hook file, Copilot ran one grep over the
aislop source to learn how the prefix is built. Harmless.

Result: G11 yes. C14 closed.
