---
type: plan
title: "Foundation: runtime hooks for Copilot and OpenCode"
summary: "Adopt the docs system and add per-edit runtime hook adapters for the Copilot shared harness and OpenCode v2"
status: in-progress
created: 2026-11-03T09:10:28
updated: 2026-11-03T09:21:42
tags: ["aislop", "hooks", "copilot", "opencode"]
---

# Foundation: runtime hooks for Copilot and OpenCode

## Status

Documentation system adopted on branch `feat/copilot-opencode-hooks`. Phase 1 complete at 674636a. Phase 2 (Copilot) not started.

## Context

aislop ships per-edit runtime hooks for Claude Code, Cursor, Gemini CLI, and pi. Copilot
is rules-only. OpenCode has no integration. This plan adds runtime hooks for the Copilot
shared harness (VS Code 1.144.0 and later, Copilot CLI 1.0.105 and later, Preview status)
and for OpenCode 2.2.4 and later.

The design was reviewed in four rounds against an advisory plan held outside the repo
(`/tmp/opencode/aislop-hooks-plan.md`, revision 4, accepted 2026-11-03). The accepted
revision, its spike evidence, and its carried findings are the source for the phases below.
Spike fixtures live in `/tmp/opencode/aislop-spikes/` until Phase 2 copies them into
`tests/hooks/fixtures/`.

Binding decisions: [KD-001](../decisions/20261103T090201--adopt-doc-conventions__aislop.md)
(documentation conventions),
[KD-002](../decisions/20261103T090819--adopt-evidence-rule__aislop.md) (evidence rule),
[KD-003](../decisions/20261103T090903--adopt-review-rule__aislop.md) (review rule),
[KD-004](../decisions/20261103T090950--copilot-reuses-claude-adapter__aislop.md) (Copilot
reuses the Claude adapter),
[KD-005](../decisions/20261103T090951--quality-gate-covers-tool-edits-only__aislop.md)
(quality gate scope).

Project constraints from `AGENTS.md`: branch from `origin/develop`, draft PR to `develop`,
`pnpm typecheck && pnpm test && pnpm scan` green, no Unix-only shell in scripts, no
self-detecting literals in detector source, no em dashes.

Baseline commit for all reviews in this plan: `ad4fc34` on `origin/develop`.

## Phases

### Phase 1: adopt the documentation system

Risk: LOW. No code. Reviewed by the audit script and the user.

- [x] Document tree `docs/plans`, `docs/decisions`, `docs/research`: [KD-001](../decisions/20261103T090201--adopt-doc-conventions__aislop.md)
- [x] `AGENTS.md` section "Project documentation": [KD-001](../decisions/20261103T090201--adopt-doc-conventions__aislop.md)
- [x] KD-001 conventions: [KD-001](../decisions/20261103T090201--adopt-doc-conventions__aislop.md)
- [x] KD-002 evidence rule: [KD-002](../decisions/20261103T090819--adopt-evidence-rule__aislop.md)
- [x] KD-003 review rule: [KD-003](../decisions/20261103T090903--adopt-review-rule__aislop.md)
- [x] KD-004 and KD-005 design decisions: [KD-004](../decisions/20261103T090950--copilot-reuses-claude-adapter__aislop.md)
- [x] Index `docs/README.md` generated with `make-index.sh`: [docs/README.md](../README.md)
- [x] Phase 1 commit on `feat/copilot-opencode-hooks`: 674636a

### Phase 2: Copilot runtime hook (WU-1)

Risk: MEDIUM. One worker, one reviewer. Consequence of a defect: a wrong hook JSON silently
disables feedback, a false block stops the agent, or an uninstall deletes user text.
Brief: delivered in-prompt by the orchestrator. It names this plan, KD-004, KD-005, the
carried findings C1, C2, C3, C5, and the fixture sources.

- [ ] `extractFiles` in `src/hooks/adapters/claude.ts` accepts `tool_input.path`
- [ ] `buildHookGroup` and `buildStopHookGroup` exported from `src/hooks/install/claude.ts`
- [ ] `src/hooks/install/copilot.ts` writes `.github/hooks/aislop.json` (project) or `$COPILOT_HOME/hooks/aislop.json` (global), nested group shape, no `version` key, Stop group only with `qualityGate`
- [ ] Project install keeps the fenced block in `.github/copilot-instructions.md`
- [ ] Global install touches no project file
- [ ] `removeMarkdownFence` in `src/hooks/io/sentinel.ts`
- [ ] Copilot uninstall removes only aislop entries and the fence
- [ ] No-flag uninstall of a both-scope agent removes a scope only when that scope holds an aislop-managed marker
- [ ] `uninstallClaude` keeps an `AISLOP.md` that lacks the fence
- [ ] Registry: copilot in `AGENTS_SUPPORTING_BOTH_SCOPES`
- [ ] `detectInstalledAgents` checks every detection scope
- [ ] `resolveOpts` no longer coerces copilot to project
- [ ] `hook status` lists paths for every detection scope
- [ ] `--quality-gate` help text per KD-005
- [ ] Fixtures copied to `tests/hooks/fixtures/`: `copilot-A-PostToolUse.json`, `copilot-E-postToolUse.json`, `copilot-A-regression-Stop.json`, `copilot-B-hookfile.json`, with a guard test that each capture array's `[0]` has an event field
- [ ] Tests red-first for every row in Mechanisms marked WU-1, with a `Test` column added
- [ ] README integration table and `docs/commands.md`: Copilot runtime, Preview status, minimum versions, trust-folder step, baseline step, KD-005 limits
- [ ] `pnpm typecheck && pnpm test && pnpm scan` captured to `/tmp/opencode/wu1-gates.txt`
- [ ] Independent review PASS, row in Review log
- [ ] Commit, staged by name

### Phase 3: OpenCode runtime hook (WU-2)

Risk: MEDIUM. One worker, one reviewer. Consequence of a defect: a thrown hook turns every
later tool call in the session into a tool error, or feedback never reaches the model.
Brief: in-prompt. It names this plan, the S3 prototype `s2/s3-plugin.ts` as reference, the
carried findings C4 and C6, and spike evidence E8 to E19 from the accepted plan.

- [ ] `src/hooks/install/opencode.ts` generates `aislop.ts` with `Plugin.define`, two hooks: `tool.hook("execute.after")` and `session.hook("context")`
- [ ] Generated plugin filters `edit`, `write`, `patch` with `status === "completed"`
- [ ] Paths from `result.output.applied[].target`, else `input.path`
- [ ] Cwd from `ctx.location.directory`
- [ ] One spawn per tool call with all paths in `file_paths`
- [ ] 8 s timeout bounds the whole hook
- [ ] `stdin.on("error")` listener
- [ ] No exception escapes either hook
- [ ] Buffer keyed by `sessionID` with 10 minute expiry
- [ ] Only a non-empty trimmed message is buffered
- [ ] `context` hook appends `{role: "user", content: [{type: "text", text}]}` to `event.messages` for its own session only and deletes the entry
- [ ] Install to `.opencode/plugins/aislop.ts` (project) or `~/.config/opencode/plugins/aislop.ts` (global)
- [ ] `opencode.json` untouched
- [ ] `src/hooks/adapters/opencode.ts` accepts `file_paths` and `file_path`, envelope `{schema: "aislop.hook.v2", block: false, message, feedback}`
- [ ] `hookInstall` rejects `--quality-gate` with `opencode` before any installer runs
- [ ] Wiring: `AgentName` in registry, feedback, telemetry
- [ ] `ALL_AGENTS`, `AGENTS_SUPPORTING_BOTH_SCOPES`, `REGISTRY`, `hookRun`, `AGENT_LABELS`, `AGENT_NAMES`, `--opencode` flag, hidden `hook opencode` command
- [ ] Fixture `opencode-patch-event.json` copied to `tests/hooks/fixtures/`
- [ ] Executed-plugin tests: transpile the generated source, stub `Plugin.define`, assert both hooks register, drive with fixtures and a stubbed spawn
- [ ] Tests red-first for every row in Mechanisms marked WU-2, with a `Test` column added
- [ ] README and `docs/commands.md`: OpenCode runtime, 2.2.4 minimum, no quality gate, shell-edit gap
- [ ] `pnpm typecheck && pnpm test && pnpm scan` captured to `/tmp/opencode/wu2-gates.txt`
- [ ] Independent review PASS, row in Review log
- [ ] Commit, staged by name

### Phase 4: integration (WU-3)

Risk: LOW. Orchestrator runs existing tools. One reviewer for the cross-seam evidence.

- [ ] Live check: generated OpenCode plugin installed in `/tmp/opencode/aislop-spikes/s2/repo`, S3 run-1 prompt, model quotes `AISLOP FEEDBACK`
- [ ] Capture named
- [ ] Live check: Copilot CLI with the generated `.github/hooks/aislop.json` in a trusted folder, PostToolUse and Stop fire
- [ ] Capture named
- [ ] Manual check Q6: VS Code 1.144.0 Copilot session target reads `.github/hooks/` and honours trust the same way as the CLI
- [ ] User at the keyboard
- [ ] Result recorded as a research note
- [ ] Cross-seam: path extraction in `claude.ts`, the pi extension, and the OpenCode plugin each mutated in turn
- [ ] Only its own test fails
- [ ] Capture named
- [ ] Cross-seam: `buildHookGroup` matcher changed
- [ ] Both installer tests fail
- [ ] Capture named
- [ ] Wave tag `wave-hooks-v1`, push with `--follow-tags` to `fork`
- [ ] Draft PR to `scanaislop/aislop` `develop`

## Mechanisms

| Mechanism | Property that must hold | Literal value |
| --- | --- | --- |
| WU-1 `extractFiles` path key | A Copilot PostToolUse payload yields its one file | `tool_input.path`, after `file_path`, before `edits[]` |
| WU-1 camelCase rejection | A native camelCase payload yields no files and no output | `toolArgs.path` ignored |
| WU-1 Copilot hook file | Generated project file equals the Copilot-accepted fixture after fixture-only command normalization | `copilot-B-hookfile.json`, no `version` key |
| WU-1 Stop group condition | Stop group present only with the gate flag | `qualityGate === true` |
| WU-1 repeat install | One aislop group per event after two installs | `upsertHookGroup` |
| WU-1 fence removal | Uninstall keeps user text outside the fence | `removeMarkdownFence` |
| WU-1 foreign entries | Uninstall keeps hook groups without the sentinel | `__aislop` absent |
| WU-1 managed-marker uninstall | No-flag uninstall touches a scope only when it holds a sentinel or fence | unmanaged `AISLOP.md` survives |
| WU-1 global scope isolation | Global install writes nothing under the project | `$COPILOT_HOME/hooks/aislop.json` only |
| WU-1 both-scope detection | A project-only install is detected and uninstalled | `detectInstalledAgents` |
| WU-1 Stop empty list | Stop with no recorded files returns no decision | KD-005 |
| WU-1 Stop recorded file | Stop rescans a recorded file changed outside the hook | KD-005 |
| WU-1 fixture guard | Each capture array's first element has an event field | `hook_event_name` or `toolName` |
| WU-1 shared matcher | Claude and Copilot installers share one matcher | `Edit\|Write\|MultiEdit` |
| WU-2 hook registration | `setup` registers both hooks | `execute.after`, `context` |
| WU-2 tool filter | Only completed file tools spawn | `edit`, `write`, `patch` with `status === "completed"` |
| WU-2 path source | Absolute targets preferred, input path as fallback | `result.output.applied[].target`, `input.path` |
| WU-2 cwd | Spawn cwd is the project directory | `ctx.location.directory` |
| WU-2 single spawn | One child per tool call carries every path | `file_paths` array |
| WU-2 timeout | Whole hook bounded, child killed, no error surfaced | 8000 ms |
| WU-2 never throw | Spawn error, bad stdout, non-zero exit, stdin error each leave the result untouched | `try/catch` in both hooks and `stdin.on("error")` |
| WU-2 session buffer | Feedback reaches only its own session | `Map<sessionID>` |
| WU-2 buffer expiry | Stale entries are swept | 600000 ms |
| WU-2 non-empty message | Empty feedback is not buffered | `message.trim().length > 0` |
| WU-2 delivery shape | Appended message is a user text part | `{role: "user", content: [{type: "text", text}]}` |
| WU-2 adapter keys | Both key forms scan | `file_paths`, `file_path` |
| WU-2 gate rejection | `--quality-gate` with opencode exits before any write | exit 1 |

## Gates

| Gate | Criterion | Target | Measured | Status |
| --- | --- | --- | --- | --- |
| G1 | `audit-docs.sh --repo .` errors after Phase 1 | 0 | 0 errors, 1 warning DOC027: [capture](../evidence/20261103-phase1-audit.md) | [x] |
| G2 | WU-1 `pnpm test` failures | 0 | | [ ] |
| G3 | WU-1 `pnpm scan` score change versus `develop` | >= 0 | | [ ] |
| G4 | WU-1 Mechanisms rows with a reviewer-confirmed deletion-discriminating test | 14 of 14 | | [ ] |
| G5 | WU-2 `pnpm test` failures | 0 | | [ ] |
| G6 | WU-2 `pnpm scan` score change versus `develop` | >= 0 | | [ ] |
| G7 | WU-2 Mechanisms rows with a reviewer-confirmed deletion-discriminating test | 13 of 13 | | [ ] |
| G8 | Live OpenCode delivery: model quotes feedback | yes | | [ ] |
| G9 | Live Copilot CLI: PostToolUse and Stop both fire from the generated file | yes | | [ ] |
| G10 | Cross-seam mutations with exactly one failing test each | 4 of 4 | | [ ] |

## Review log

Rounds 1 to 4 reviewed the advisory plan outside the repo. They are recorded here because
their findings bind Phases 2 and 3.

| Unit | Round | Reviewer verdict | Blocking | Non-blocking | Date |
| --- | --- | --- | --- | --- | --- |
| plan | 1 | BLOCK | 4 | 2 | 2026-10-30 |
| plan | 2 | BLOCK | 5 | 2 | 2026-10-30 |
| plan | 3 | BLOCK | 4 | 2 | 2026-10-30 |
| plan | 4 | BLOCK, accepted by user with carried findings | 4 | 2 | 2026-10-30 |

## Carried findings

| # | Finding | Source | Folded into |
| - | --- | --- | --- |
| C1 | Hook file has no `version` key. The equality test normalizes only the fixture's commands | plan round 4 | Phase 2 hook file task |
| C2 | No-flag uninstall requires a managed marker per scope. An `AISLOP.md` without a fence survives | plan round 4 | Phase 2 uninstall task |
| C3 | Global Copilot install touches no project file | plan round 4 | Phase 2 global install task |
| C4 | One spawn per tool call with `file_paths`. 8 s bounds the whole hook | plan round 4 | Phase 3 spawn task |
| C5 | KD-005 text names `MultiEdit`, tracked-file rescan, cross-session carryover | plan round 4 | Phase 2 help text task, KD-005 |
| C6 | Buffer only a non-empty trimmed message | plan round 4 | Phase 3 buffer task |
| C7 | Copilot telemetry reports `agent: "claude"` | plan round 2 | Documented gap in Phase 2 docs task |
| C8 | Shell-tool edits fire no file hook on any host | spikes E7, E17 | Documented gap, KD-005 |
| C9 | Native camelCase Copilot payload unsupported | KD-004 | Documented in Phase 2 docs task |

## Related

- Advisory plan, revision 4 accepted: `/tmp/opencode/aislop-hooks-plan.md` (scratch, not durable, its content is reflected above)
- Spike reports: `/tmp/opencode/aislop-spikes/s1/REPORT.md`, `s2/REPORT.md`, `s2/REPORT-followup.md`, `s2/REPORT-s3.md`
- Upstream repo: https://github.com/scanaislop/aislop, fork: https://github.com/eric-dishman-ctct/aislop
