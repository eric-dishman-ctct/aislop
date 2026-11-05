import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hookInstall, hookUninstall } from "../../src/commands/hook.js";
import { runClaudeHook } from "../../src/hooks/adapters/claude.js";
import { runPiHook } from "../../src/hooks/adapters/pi.js";
import { runHookDoctor } from "../../src/hooks/doctor.js";
import { installClaude } from "../../src/hooks/install/claude.js";
import { resolveHookRoot } from "../../src/hooks/io/project-root.js";
import { hookStatus } from "../../src/hooks/status-render.js";
import { writeHookRuntime } from "../../src/hooks/runtime/runtime-file.js";

let tmp: string;

const mkdir = (...parts: string[]): string => {
	const dir = path.join(tmp, ...parts);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
};

const write = (rel: string, content: string): string => {
	const file = path.join(tmp, rel);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
	return file;
};

beforeEach(() => {
	tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aislop-hook-root-")));
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(tmp, { recursive: true, force: true });
});

describe("resolveHookRoot", () => {
	it("prefers the nearest directory whose .aislop holds project config", () => {
		mkdir(".git");
		write(".aislop/config.yml", "");
		write("packages/a/.aislop/config.yml", "");
		expect(resolveHookRoot(mkdir("docs", "deep"))).toBe(tmp);
		expect(resolveHookRoot(mkdir("packages", "a", "src"))).toBe(path.join(tmp, "packages", "a"));
	});

	it("treats a .yaml config as project config", () => {
		mkdir(".git");
		write("packages/a/.aislop/config.yaml", "");
		expect(resolveHookRoot(mkdir("packages", "a", "src"))).toBe(path.join(tmp, "packages", "a"));
	});

	it("falls back to the git root when no .aislop config exists", () => {
		mkdir(".git");
		expect(resolveHookRoot(mkdir("docs"))).toBe(tmp);
	});

	it("ignores a stray nested .aislop left behind by older hooks", () => {
		mkdir(".git");
		write(".aislop/baseline.json", "{}");
		write("docs/.aislop/session.jsonl", "");
		expect(resolveHookRoot(path.join(tmp, "docs"))).toBe(tmp);
	});

	it("never treats the home directory's .aislop as the project", () => {
		vi.spyOn(os, "homedir").mockReturnValue(tmp);
		write(".aislop/config.yml", "");
		write(".aislop/install_id", "x");
		mkdir("proj", ".git");
		expect(resolveHookRoot(mkdir("proj", "docs"))).toBe(path.join(tmp, "proj"));
	});

	it("stops at the git root instead of walking into parent projects", () => {
		write(".aislop/config.yml", "");
		mkdir("inner", ".git");
		expect(resolveHookRoot(mkdir("inner", "src"))).toBe(path.join(tmp, "inner"));
	});

	it("returns the directory itself outside any repository", () => {
		const dir = mkdir("loose");
		expect(resolveHookRoot(dir)).toBe(dir);
	});
});

describe("U7 project root hook commands", () => {
	const flags = {
		agents: ["claude" as const],
		scope: "project" as const,
		dryRun: false,
		yes: true,
		qualityGate: true,
	};

	it("install root: writes project hooks, runtime, and baseline at the git root", async () => {
		const home = mkdir("home");
		mkdir(".git");
		const nested = mkdir("src", "deep");
		write("source.ts", "export const value = 1;\n");
		vi.spyOn(os, "homedir").mockReturnValue(home);
		vi.spyOn(process, "cwd").mockReturnValue(nested);
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		await hookInstall(flags);
		for (const file of [
			".claude/settings.json",
			".aislop/hook-runtime.json",
			".aislop/baseline.json",
		])
			expect(fs.existsSync(path.join(tmp, file))).toBe(true);
		expect(fs.existsSync(path.join(nested, ".claude/settings.json"))).toBe(false);
		expect(fs.existsSync(path.join(nested, ".aislop/hook-runtime.json"))).toBe(false);
		expect(fs.existsSync(path.join(nested, ".aislop/baseline.json"))).toBe(false);
	});

	it("uninstall root: removes root settings from a nested directory", async () => {
		const home = mkdir("home");
		mkdir(".git");
		const nested = mkdir("src", "deep");
		installClaude({ home, cwd: tmp, scope: "project", qualityGate: false });
		vi.spyOn(os, "homedir").mockReturnValue(home);
		vi.spyOn(process, "cwd").mockReturnValue(nested);
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		await hookUninstall({
			agents: ["claude"],
			scope: "project",
			dryRun: false,
			yes: true,
			qualityGate: false,
			explicitScope: true,
		});
		const settings = path.join(tmp, ".claude", "settings.json");
		expect(fs.existsSync(settings) ? fs.readFileSync(settings, "utf8") : "").not.toContain("aislop");
	});

	it("doctor root: reads project hooks, runtime, and baseline from the git root", async () => {
		const home = mkdir("home");
		mkdir(".git");
		const nested = mkdir("src", "deep");
		installClaude({ home, cwd: tmp, scope: "project", qualityGate: true });
		writeHookRuntime("project", { cwd: tmp });
		write(".aislop/baseline.json", JSON.stringify({ schema: "aislop.baseline.v2", score: 100 }));
		const report = await runHookDoctor({ project: true, home, cwd: nested });
		expect(report.entries).not.toHaveLength(0);
		expect(report.runtime).toEqual([expect.objectContaining({ status: "ok" })]);
		expect(report.baseline).toEqual([{ scope: "project", status: "ok", score: 100 }]);
	});

	it("status root: lists a project install from a nested directory", async () => {
		const home = mkdir("home");
		mkdir(".git");
		const nested = mkdir("src", "deep");
		installClaude({ home, cwd: tmp, scope: "project", qualityGate: false });
		const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		await hookStatus(nested, home);
		const rendered = output.mock.calls.map(([text]) => String(text)).join("");
		expect(rendered).toContain(path.join(tmp, ".claude/settings.json"));
		expect(rendered).toMatch(/claude[\s\S]*installed/i);
	});

	it("doctor probe sends the project root as cwd", async () => {
		const home = mkdir("home");
		mkdir(".git");
		const nested = mkdir("src", "deep");
		const captured = path.join(tmp, "probe.json");
		const script = `process.stdin.on("data", data => require("node:fs").writeFileSync(${JSON.stringify(captured)}, data));process.stdin.on("end", () => console.log(JSON.stringify({schema:"aislop.hook.probe.v1",version:"test",cliPath:"test"})))`;
		write(
			".claude/settings.json",
			JSON.stringify({
				hooks: {
					PostToolUse: [
						{ hooks: [{ exec: process.execPath, args: ["-e", script, "--"], __aislop: { managed: true } }] },
					],
				},
			}),
		);
		await runHookDoctor({ project: true, home, cwd: nested });
		expect(JSON.parse(fs.readFileSync(captured, "utf8"))).toMatchObject({ cwd: tmp });
	});

	it("global unchanged: writes global files without using the project root", async () => {
		const home = mkdir("home");
		mkdir(".git");
		const nested = mkdir("src", "deep");
		vi.spyOn(os, "homedir").mockReturnValue(home);
		vi.spyOn(process, "cwd").mockReturnValue(nested);
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		await hookInstall({ ...flags, scope: "global", qualityGate: false });
		expect(fs.existsSync(path.join(home, ".claude/settings.json"))).toBe(true);
		expect(fs.existsSync(path.join(home, ".aislop/hook-runtime.json"))).toBe(true);
		expect(fs.existsSync(path.join(tmp, ".claude/settings.json"))).toBe(false);
		expect(fs.existsSync(path.join(nested, ".claude/settings.json"))).toBe(false);
	});
});

describe("hooks run from a nested cwd", () => {
	beforeEach(() => {
		mkdir(".git");
		mkdir(".aislop");
		write("package.json", '{"name":"demo","version":"1.0.0"}');
	});

	it("keeps session state at the project root", async () => {
		const file = write("docs/a.ts", "export const a = 1;\n");
		await runClaudeHook({
			stdin: async () =>
				JSON.stringify({ tool_input: { file_path: file }, cwd: path.join(tmp, "docs") }),
			write: () => undefined,
		});
		expect(fs.existsSync(path.join(tmp, "docs", ".aislop"))).toBe(false);
		expect(fs.existsSync(path.join(tmp, ".aislop", "session.jsonl"))).toBe(true);
	});

	it("resolves a relative file path against the agent's cwd", async () => {
		write("docs/x.ts", "export const a = 1;\n");
		await runPiHook({
			stdin: async () => JSON.stringify({ cwd: path.join(tmp, "docs"), file_path: "x.ts" }),
			write: () => undefined,
		});
		const session = fs.readFileSync(path.join(tmp, ".aislop", "session.jsonl"), "utf-8");
		expect(session).toContain("x.ts");
		expect(fs.existsSync(path.join(tmp, "docs", ".aislop"))).toBe(false);
	});
});
