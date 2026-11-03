# WU-3 integration captures

Date: 2026-11-03T11:57:31. Branch feat/copilot-opencode-hooks at bfc9519.

## Live Copilot CLI, generated hook file, quality gate

Log: [copilot-cli-hook-log](20261103-wu3-copilot-cli-hook-log.txt). Sequence of aislop calls:

```text
ARGS=hook claude
ARGS=hook claude --stop
ARGS=scan src/index.ts
ARGS=scan
ARGS=scan
ARGS=hook claude --stop
```

PostToolUse returned score 58, baseline 100, regressed true. Stop returned `decision: block`. Copilot ran the scanner, fixed the findings, and the final Stop with `stop_hook_active: true` returned nothing.

## Cross-seam mutations (scratch copy of the tree)

| Seam | Mutation | Result |
| --- | --- | --- |
| X1 | see plan | ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
Tests  1 failed | 186 passed (187) |
| X2 | see plan | Tests  187 passed (187) |
| X3 | see plan | ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
Tests  2 failed | 185 passed (187) |
| X4 | see plan | ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
Tests  2 failed | 185 passed (187) |

Failing tests:

```text
 FAIL  tests/hooks/hook-root.test.ts > hooks run from a nested cwd > keeps session state at the project root
 FAIL  tests/hooks/install-opencode.test.ts > OpenCode runtime plugin > registers hooks, scans completed file tools once, and delivers session feedback
 FAIL  tests/hooks/install-opencode.test.ts > OpenCode runtime plugin > spawns one child for all patch targets
 FAIL  tests/hooks/install-claude.test.ts > installClaude global > writes settings.json, AISLOP.md, and CLAUDE.md on fresh install
 FAIL  tests/hooks/install-copilot.test.ts > Copilot runtime hooks > matches the accepted hook-file groups without a version or FileChanged group
```

X2 (pi extension path key) produced no failure. Pre-existing gap, carried finding C13.
