import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerHookCommand } from "../../src/cli/hook-command.js";
import {
	AGENT_LABELS,
	defaultInstallTargets,
	hookInstall,
	hookUninstall,
	parseAgentFlag,
	resolveAgents,
	resolveHookInstallOpts,
} from "../../src/commands/hook.js";
import { installClaude, resolveClaudePaths } from "../../src/hooks/install/claude.js";

const tempDirs: string[] = [];
const tempDir = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-uninstall-"));
	tempDirs.push(dir);
	return dir;
};

afterEach(() => {
	vi.restoreAllMocks();
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const uninstallFlags = (explicitScope = false, scope: "global" | "project" = "global") => ({
	agents: ["claude" as const],
	scope,
	dryRun: false,
	yes: true,
	qualityGate: false,
	explicitScope,
});

const captureUninstall = async (flags = uninstallFlags()): Promise<string> => {
	const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	await hookUninstall(flags);
	return output.mock.calls.map(([text]) => String(text)).join("");
};

const installManagedClaude = (home: string, cwd: string, scope: "global" | "project"): void => {
	installClaude({ home, cwd, scope, qualityGate: false });
};

describe("hook uninstall scope markers", () => {
	it("keeps unmanaged project Claude files when no scope flag is set", async () => {
		const home = tempDir();
		const cwd = tempDir();
		installManagedClaude(home, cwd, "global");
		const project = resolveClaudePaths({ home, cwd, scope: "project", qualityGate: false });
		fs.mkdirSync(path.dirname(project.settings), { recursive: true });
		const unmanagedRules = "# Project rules\nKeep this.\n";
		const foreignSettings = '{"hooks":{"PostToolUse":[{"hooks":[{"command":"foreign"}]}]}}\n';
		fs.writeFileSync(project.aislopMd, unmanagedRules);
		fs.writeFileSync(project.settings, foreignSettings);
		const oldHome = process.env.HOME;
		const oldCwd = process.cwd();
		process.env.HOME = home;
		process.chdir(cwd);
		try {
			const output = await captureUninstall();
			expect(fs.readFileSync(project.aislopMd, "utf8")).toBe(unmanagedRules);
			expect(fs.readFileSync(project.settings, "utf8")).toBe(foreignSettings);
			expect(
				fs.existsSync(
					resolveClaudePaths({ home, cwd, scope: "global", qualityGate: false }).settings,
				),
			).toBe(false);
			expect(output.match(/Scope/g) ?? []).toHaveLength(1);
		} finally {
			process.chdir(oldCwd);
			process.env.HOME = oldHome;
		}
	});

	it("removes both managed Claude scopes without a scope flag", async () => {
		const home = tempDir();
		const cwd = tempDir();
		installManagedClaude(home, cwd, "global");
		installManagedClaude(home, cwd, "project");
		const oldHome = process.env.HOME;
		const oldCwd = process.cwd();
		process.env.HOME = home;
		process.chdir(cwd);
		try {
			const output = await captureUninstall();
			expect(output.match(/Scope/g) ?? []).toHaveLength(2);
			expect(
				fs.existsSync(
					resolveClaudePaths({ home, cwd, scope: "global", qualityGate: false }).settings,
				),
			).toBe(false);
			expect(
				fs.existsSync(
					resolveClaudePaths({ home, cwd, scope: "project", qualityGate: false }).settings,
				),
			).toBe(false);
		} finally {
			process.chdir(oldCwd);
			process.env.HOME = oldHome;
		}
	});

	it("removes only the project Claude scope with --project", async () => {
		const home = tempDir();
		const cwd = tempDir();
		installManagedClaude(home, cwd, "global");
		installManagedClaude(home, cwd, "project");
		const oldHome = process.env.HOME;
		const oldCwd = process.cwd();
		process.env.HOME = home;
		process.chdir(cwd);
		try {
			const output = await captureUninstall(uninstallFlags(true, "project"));
			expect(output.match(/Scope/g) ?? []).toHaveLength(1);
			expect(
				fs.existsSync(
					resolveClaudePaths({ home, cwd, scope: "project", qualityGate: false }).settings,
				),
			).toBe(false);
			expect(
				fs.existsSync(
					resolveClaudePaths({ home, cwd, scope: "global", qualityGate: false }).settings,
				),
			).toBe(true);
		} finally {
			process.chdir(oldCwd);
			process.env.HOME = oldHome;
		}
	});
});

describe("hook uninstall options", () => {
	it("parses --yes as a no-op with a dry run", async () => {
		const program = new Command();
		registerHookCommand(program);
		const hook = program.commands.find((command) => command.name() === "hook");
		const uninstall = hook?.commands.find((command) => command.name() === "uninstall");
		let options: { yes?: boolean; dryRun?: boolean } | undefined;
		uninstall?.action((_agents, parsed) => {
			options = parsed as { yes?: boolean; dryRun?: boolean };
		});

		await program.parseAsync(["hook", "uninstall", "--claude", "--yes", "--dry-run"], {
			from: "user",
		});
		expect(options).toMatchObject({ yes: true, dryRun: true, claude: true });
	});
});

describe("agent selection labels", () => {
	it("describes Copilot as a runtime hook", () => {
		expect(AGENT_LABELS.copilot.hint).not.toContain("rules-only");
	});
});

describe("parseAgentFlag", () => {
	it("returns the fallback when no arg is provided", () => {
		const fallback = defaultInstallTargets();
		expect(parseAgentFlag(undefined, fallback)).toEqual(fallback);
	});

	it("parses a single agent", () => {
		expect(parseAgentFlag("claude", [])).toEqual(["claude"]);
	});

	it("parses a comma-separated list and trims whitespace", () => {
		expect(parseAgentFlag("claude, cursor ,gemini", [])).toEqual(["claude", "cursor", "gemini"]);
	});

	it("drops empty segments from the list", () => {
		expect(parseAgentFlag("claude,,cursor", [])).toEqual(["claude", "cursor"]);
	});

	it("throws on an unknown agent name", () => {
		expect(() => parseAgentFlag("claude,nope", [])).toThrowError(/Unknown agent/);
	});

	it("throws naming every unknown agent at once", () => {
		expect(() => parseAgentFlag("claude,nope,also-nope", [])).toThrowError(/nope, also-nope/);
	});
});

describe("defaultInstallTargets", () => {
	it("returns the both-scope agent list by default", () => {
		const targets = defaultInstallTargets();
		expect(targets).toContain("claude");
		expect(targets).toContain("cursor");
		expect(targets).toContain("gemini");
		expect(targets).toContain("codex");
		expect(targets).not.toContain("windsurf");
		expect(targets).toContain("copilot");
	});
});

describe("resolveAgents", () => {
	it("picks per-agent flags when set", () => {
		expect(resolveAgents({ claude: true, cursor: true }, [], undefined, [])).toEqual([
			"claude",
			"cursor",
		]);
	});

	it("preserves the canonical ordering regardless of flag order", () => {
		expect(resolveAgents({ gemini: true, claude: true }, [], undefined, [])).toEqual([
			"claude",
			"gemini",
		]);
	});

	it("falls back to positional args when no per-agent flags set", () => {
		expect(resolveAgents({}, ["claude", "gemini"], undefined, [])).toEqual(["claude", "gemini"]);
	});

	it("per-agent flags beat positional args", () => {
		expect(resolveAgents({ claude: true }, ["cursor"], undefined, [])).toEqual(["claude"]);
	});

	it("falls back to --agent comma list when neither flags nor positional are set", () => {
		expect(resolveAgents({}, [], "claude,cursor", [])).toEqual(["claude", "cursor"]);
	});

	it("falls back to the provided fallback when nothing is passed", () => {
		const fallback = defaultInstallTargets();
		expect(resolveAgents({}, [], undefined, fallback)).toEqual(fallback);
	});

	it("throws on an unknown positional agent", () => {
		expect(() => resolveAgents({}, ["claude", "nope"], undefined, [])).toThrowError(
			/Unknown agent/,
		);
	});

	it("positional args beat --agent", () => {
		expect(resolveAgents({}, ["claude"], "gemini", [])).toEqual(["claude"]);
	});
});

describe("hook install command form", () => {
	it("uses absolute commands globally and portable commands in projects unless forced", () => {
		const flags = { agents: ["claude" as const], dryRun: false, yes: true, qualityGate: false };
		expect(resolveHookInstallOpts("claude", { ...flags, scope: "global" }).absolute).toBe(true);
		expect(resolveHookInstallOpts("claude", { ...flags, scope: "project" }).absolute).toBe(false);
		expect(
			resolveHookInstallOpts("claude", { ...flags, scope: "project", absolute: true }).absolute,
		).toBe(true);
	});

	it("names a portable command rewrite after a global reinstall", async () => {
		const home = tempDir();
		const cwd = tempDir();
		installClaude({ home, cwd, scope: "global", absolute: false });
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		vi.spyOn(os, "homedir").mockReturnValue(home);
		vi.spyOn(process, "cwd").mockReturnValue(cwd);
		await hookInstall({
			agents: ["claude"],
			scope: "global",
			dryRun: false,
			yes: true,
			qualityGate: false,
		});
		const output = stdout.mock.calls.map(([text]) => String(text)).join("");
		expect(output).toContain("Rewrote portable command");
	});

	it("rewrites a stale absolute command on a global reinstall", async () => {
		const home = tempDir();
		const cwd = tempDir();
		const paths = resolveClaudePaths({ home, cwd, scope: "global", qualityGate: false });
		fs.mkdirSync(path.dirname(paths.settings), { recursive: true });
		fs.writeFileSync(paths.settings, JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{
			type: "command",
			command: "'/missing/node' '/missing/cli' hook claude",
			__aislop: { managed: true },
		}] }] } }));
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		vi.spyOn(os, "homedir").mockReturnValue(home);
		vi.spyOn(process, "cwd").mockReturnValue(cwd);
		await hookInstall({ agents: ["claude"], scope: "global", dryRun: false, yes: true, qualityGate: false });
		const output = stdout.mock.calls.map(([text]) => String(text)).join("");
		const settings = fs.readFileSync(paths.settings, "utf8");
		expect(settings).toContain(process.execPath);
		expect(output).toContain("Rewrote stale absolute command");
	});

	it("does not name a portable command rewrite on a fresh install", async () => {
		const home = tempDir();
		const cwd = tempDir();
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		vi.spyOn(os, "homedir").mockReturnValue(home);
		vi.spyOn(process, "cwd").mockReturnValue(cwd);
		await hookInstall({
			agents: ["claude"],
			scope: "global",
			dryRun: false,
			yes: true,
			qualityGate: false,
		});
		const output = stdout.mock.calls.map(([text]) => String(text)).join("");
		expect(output).not.toContain("Rewrote portable command");
	});

	it("prints the do-not-commit reminder for an absolute project install", async () => {
		const home = tempDir();
		const cwd = tempDir();
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		vi.spyOn(os, "homedir").mockReturnValue(home);
		vi.spyOn(process, "cwd").mockReturnValue(cwd);
		await hookInstall({
			agents: ["codex"],
			scope: "project",
			dryRun: false,
			yes: true,
			qualityGate: false,
			absolute: true,
		});
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("do not commit"));
	});
});

describe("OpenCode quality gate", () => {
	it("rejects OpenCode before an installer can write", async () => {
		const { hookInstall } = await import("../../src/commands/hook.js");
		const home = tempDir();
		const cwd = tempDir();
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		vi.spyOn(os, "homedir").mockReturnValue(home);
		vi.spyOn(process, "cwd").mockReturnValue(cwd);
		const originalExitCode = process.exitCode;
		process.exitCode = undefined;
		try {
			await hookInstall({
				agents: ["opencode"],
				scope: "project",
				dryRun: false,
				yes: true,
				qualityGate: true,
			});
			expect(process.exitCode).toBe(1);
			expect(stderr).toHaveBeenCalledWith(expect.stringContaining("not available for OpenCode"));
			expect(fs.existsSync(path.join(cwd, ".opencode", "plugins", "aislop.ts"))).toBe(false);
		} finally {
			process.exitCode = originalExitCode;
			stderr.mockRestore();
		}
	});
});
