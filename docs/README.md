# Documentation index

This file is generated from document front matter by make-index.sh (or its
PowerShell twin make-index.ps1) in the project-docs-conventions skill.
Do not edit it by hand. Regenerate it after any document change; audit rule
DOC026 reports a stale copy.

## Plans

| Id | Title | Status | Scope |
| -- | ----- | ------ | ----- |
| [foundation](plans/20261103T091028--foundation__aislop.md) | Foundation: runtime hooks for Copilot and OpenCode | in-progress | Adopt the docs system and add per-edit runtime hook adapters for the Copilot shared harness and OpenCode v2 |

## Decisions

| Id | Title | Status | Scope |
| -- | ----- | ------ | ----- |
| [KD-001](decisions/20261103T090201--adopt-doc-conventions__aislop.md) | Adopt doc conventions | accepted | Plans, decisions, and research notes follow the project-docs-conventions skill |
| [KD-002](decisions/20261103T090819--adopt-evidence-rule__aislop.md) | Adopt evidence rule | accepted | Claims about measurements cite the verbatim command and its actual captured output |
| [KD-003](decisions/20261103T090903--adopt-review-rule__aislop.md) | Adopt review rule | accepted | Changes get independent fresh-context review before commit; sub-agents never commit |
| [KD-004](decisions/20261103T090950--copilot-reuses-claude-adapter__aislop.md) | Copilot reuses the Claude hook adapter | accepted | The Copilot shared harness calls aislop hook claude; no copilot runtime adapter is written |
| [KD-005](decisions/20261103T090951--quality-gate-covers-tool-edits-only__aislop.md) | Quality gate covers tool-observed edits only | accepted | The Stop gate rescans files recorded by Edit, Write, and MultiEdit calls; shell edits to unrecorded files are not seen |
| [KD-006](decisions/20261103T121350--fork-does-not-contribute-upstream__aislop.md) | The fork pulls from upstream and does not contribute back | accepted | eric-dishman-ctct/aislop tracks scanaislop/aislop develop as a pull-only source, and no pull requests go upstream |

## Research

| Id | Title | Status | Scope |
| -- | ----- | ------ | ----- |
| [R-001](research/20261103T115650--vscode-copilot-hook-delivery__aislop.md) | VS Code Copilot session target reads the aislop hook file | concluded | Q6 from the foundation plan: VS Code 1.144.0 fires PostToolUse and Stop from .github/hooks/aislop.json with the same payload as the Copilot CLI, but its hook process has a minimal PATH |
| [R-002](research/20261103T130449--hook-command-binary-resolution__aislop.md) | How aislop hook commands find the binary, and what each host gives them | concluded | Survey of the six installers' command strings, the sentinel hash, host hook environments, and precedents from husky and pre-commit, to ground a decision on PATH-independent hook commands |
| [R-003](research/20261103T132420--hook-command-environment-probes__aislop.md) | Hook command environment probes: absolute node and cli paths work in VS Code | concluded | Live probes in Copilot CLI and VS Code 1.144.0 answer the open questions from R-002: VS Code lacks only the nvm bin directory, absolute node plus cli.js works in both hosts and both command forms, env.PATH does not expand, and VS Code loads hook files at runtime start |
