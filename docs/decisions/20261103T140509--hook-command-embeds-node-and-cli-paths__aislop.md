---
type: decision
id: KD-007
title: "Hook commands embed the Node and CLI paths resolved at install time"
summary: "Global installs write an absolute node plus cli.js command in each host's native form, project installs keep the portable string unless the user opts in, plugins resolve at run time, and the installer refuses temporary executions"
status: accepted
created: 2026-11-03T14:05:09
updated: 2026-11-03T15:47:37
tags: ["aislop", "hooks", "path"]
---

# KD-007: Hook commands embed the Node and CLI paths resolved at install time

**Decision:** Hook installers stop depending on `PATH` lookup of `aislop` and `node`.

1. **Resolution.** At install time the CLI resolves `process.execPath` (the running Node)
   and the absolute path of its own `dist/cli.js` (from `import.meta.url`). It records both
   in a small `.aislop/hook-runtime.json` next to the baseline, with the aislop version.
2. **Global scope.** Shell-string installers (Claude, Cursor, Gemini, Copilot) write the
   absolute pair in the host's native form. Copilot writes `exec` plus `args`, which needs
   no shell quoting ([R-003](../research/20261103T132420--hook-command-environment-probes__aislop.md)).
   Claude, Cursor, and Gemini write a quoted command string built by a per-host,
   per-platform builder. Windows builders are written and unit-tested for spaces,
   backslashes, and apostrophes, but ship marked unverified until a Windows probe runs.
3. **Project scope.** The committed file keeps the portable `aislop hook <agent>` string
   by default, because an absolute home path in a checkout breaks every other developer
   and every container. `--absolute` opts in to the machine form and prints a reminder to
   keep the file out of version control.
4. **Plugins (pi, OpenCode).** The generated JavaScript resolves at run time in this
   order: `AISLOP_BIN` as a separate executable branch, then the absolute pair recorded at
   install, then bare `aislop` on `PATH`. The plugin spawns `node` with `cli.js` as the
   first argument, so no shell is involved.
5. **Temporary executions.** When the running CLI lives under an `npx`, `bunx`,
   `pnpm dlx`, or `yarn dlx` cache, `hook install` refuses to write an absolute command
   and prints the stable install command. `--force-temporary` overrides with a warning.
6. **Doctor.** `aislop hook doctor` executes every managed hook in every detected scope
   with a probe payload, reports the aislop version each one runs and where it lives, and
   flags a stale Node or CLI path. `hook install` on a stale path rewrites it.

**Status:** Accepted by the user on 2026-11-03. Project scope keeps the portable string by default (option A). The work gets its own plan.

**Rationale:** [R-001](../research/20261103T115650--vscode-copilot-hook-delivery__aislop.md)
observed silent hooks in VS Code. [R-002](../research/20261103T130449--hook-command-binary-resolution__aislop.md)
showed all six installers depend on `PATH` and that the sentinel never compares the
command string, so a per-machine string is safe for upsert and removal. R-003 measured the
cause: VS Code's hook `PATH` lacks only the nvm bin directory, and both absolute forms work
in VS Code and the CLI on real Edit and Stop events, including a complete block-and-fix
cycle. The independent design review (2026-11-03) endorsed the absolute form with three
changes: per-host builders, a temporary-install guard, and a project-scope policy. Items
2, 5, and 3 above are those changes. The pre-commit precedent embeds the interpreter in
the same way.

**Alternatives rejected:**
- Absolute path of the `aislop` launcher only. Rejected: its `#!/usr/bin/env node` shebang
  still needs `node` on `PATH`, which is the failing lookup.
- A tool-owned launcher script beside the hook file. Rejected for the first version: a
  second file per host, a `.cmd` twin on Windows, and it does not fix the shebang by
  itself. Possible later if relocation proves common.
- Copilot `env.PATH`. Rejected: `$PATH` is not expanded (R-003), so only a literal list is
  possible, and it does not help the other hosts.
- Keep `PATH` lookup and document the workaround. Rejected: the failure is silent, and
  nvm is the most common Node install for developers.

**Consequences:**
- A Node upgrade through nvm, or an aislop upgrade to a new directory, makes the global
  hook stale. `hook doctor` reports it and `hook install` repairs it. Docs say to rerun
  install after upgrading Node or aislop.
- The Copilot fixture-equality test and the Claude, Cursor, and Gemini literal-command
  tests change to compare structure and normalized commands, not the literal
  `aislop hook <agent>`.
- The sentinel hash changes per machine. Harmless, since nothing compares it.
- A Windows probe is a prerequisite for removing the "unverified" label on the Windows
  builders. It needs a Windows host.
- Work lands in a new plan, with one unit for the resolver and guard, one for the
  shell-string installers, one for the plugin installers, and one for `hook doctor`.

**Related:** KD-004, KD-005, R-001, R-002, R-003.
