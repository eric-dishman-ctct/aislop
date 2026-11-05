import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const tempDir = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-runtime-built-"));
	tempDirs.push(dir);
	return dir;
};

const runtimeJson = (cli: string, args: string[] = []): { cliPath: string; source: string } => {
	const home = tempDir();
	return JSON.parse(
		execFileSync(process.execPath, [...args, cli, "hook", "runtime", "--json"], {
			encoding: "utf8",
			env: { ...process.env, HOME: home },
		}),
	);
};

afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("U1 built-CLI resolution", () => {
	it("built-CLI resolution: reports the canonical dist CLI path", () => {
		const cli = path.resolve("dist/cli.js");
		if (!fs.existsSync(cli)) execFileSync("pnpm", ["build"], { stdio: "inherit" });
		const runtime = runtimeJson(cli);
		expect(runtime.cliPath).toMatch(/dist[/\\]cli\.js$/);
		expect(runtime.cliPath).toBe(fs.realpathSync(cli));
		expect(runtime.source).toBe("none");
	});

	it("U8 built CLI: refuses temporary installs without creating an identity", () => {
		const temporaryDir = path.join(tempDir(), "_npx", "aislop");
		const temporaryCli = path.join(temporaryDir, "cli.js");
		fs.mkdirSync(temporaryDir, { recursive: true });
		fs.copyFileSync(path.resolve("dist/cli.js"), temporaryCli);
		fs.symlinkSync(path.resolve("node_modules"), path.join(temporaryDir, "node_modules"));

		for (const command of [["hook", "install"], ["hooks", "install"], ["install"]]) {
			const home = tempDir();
			const env = {
				...process.env,
				HOME: home,
				AISLOP_TELEMETRY_DEBUG: "1",
				AISLOP_TELEMETRY_DRY_RUN: "1",
			};
			delete env.CI;
			delete env.AISLOP_NO_TELEMETRY;
			delete env.XDG_STATE_HOME;

			const refused = spawnSync(
				process.execPath,
				[temporaryCli, ...command, "--claude", "--global", "--yes"],
				{ env, encoding: "utf8" },
			);
			expect(refused.status).toBe(1);
			expect(fs.existsSync(path.join(home, ".aislop"))).toBe(false);
			expect(fs.existsSync(path.join(home, ".claude"))).toBe(false);
			expect(refused.stderr).not.toContain('"event":"cli_installed"');
		}

		const forcedHome = tempDir();
		const forcedEnv = {
			...process.env,
			HOME: forcedHome,
			AISLOP_TELEMETRY_DEBUG: "1",
			AISLOP_TELEMETRY_DRY_RUN: "1",
		};
		delete forcedEnv.CI;
		delete forcedEnv.AISLOP_NO_TELEMETRY;
		delete forcedEnv.XDG_STATE_HOME;
		const forced = spawnSync(
			process.execPath,
			[temporaryCli, "hook", "install", "--claude", "--global", "--yes", "--force-temporary"],
			{ env: forcedEnv, encoding: "utf8" },
		);
		expect(forced.status).toBe(0);
		expect(fs.existsSync(path.join(forcedHome, ".aislop", "install_id"))).toBe(true);
		expect(forced.stderr).toContain('"event":"cli_installed"');
	});

	it("built-CLI resolution: resolves a symlink to its target", () => {
		const cli = path.resolve("dist/cli.js");
		if (!fs.existsSync(cli)) execFileSync("pnpm", ["build"], { stdio: "inherit" });
		const linkedCli = path.resolve("dist/aislop-runtime-link.js");
		fs.symlinkSync(cli, linkedCli);
		try {
			const runtime = runtimeJson(linkedCli, ["--preserve-symlinks-main"]);
			expect(linkedCli).not.toBe(cli);
			expect(runtime.cliPath).toBe(fs.realpathSync(cli));
			expect(runtime.cliPath).not.toBe(linkedCli);
		} finally {
			fs.unlinkSync(linkedCli);
		}
	});

	it("U6 built CLI: blocks the first regression after quality-gate install", () => {
		const cwd = tempDir();
		const home = tempDir();
		const cli = path.resolve("dist/cli.js");
		const file = path.join(cwd, "regression.ts");
		spawnSync("git", ["init", "-q"], { cwd, encoding: "utf8" });
		fs.writeFileSync(file, "export const value = 1;\n");
		execFileSync(
			process.execPath,
			[cli, "hook", "install", "--claude", "--project", "--quality-gate", "--yes"],
			{
				cwd,
				env: { ...process.env, HOME: home, AISLOP_TELEMETRY: "0" },
				encoding: "utf8",
			},
		);
		expect(fs.existsSync(path.join(cwd, ".aislop", "baseline.json"))).toBe(true);
		fs.writeFileSync(file, "export const value = {} as any;\n");
		const post = {
			hook_event_name: "PostToolUse",
			cwd,
			tool_name: "Edit",
			tool_input: { path: file },
		};
		execFileSync(process.execPath, [cli, "hook", "claude"], {
			cwd,
			input: JSON.stringify(post),
			env: { ...process.env, HOME: home, AISLOP_TELEMETRY: "0" },
			encoding: "utf8",
		});
		const stop = execFileSync(process.execPath, [cli, "hook", "claude", "--stop"], {
			cwd,
			input: JSON.stringify({ hook_event_name: "Stop", cwd }),
			env: { ...process.env, HOME: home, AISLOP_TELEMETRY: "0" },
			encoding: "utf8",
		});
		expect(JSON.parse(stop).decision).toBe("block");
	});

	it("U7 built CLI install root: writes project hook state at the git root", () => {
		const root = tempDir();
		const nested = path.join(root, "src", "deep");
		const home = tempDir();
		const cli = path.resolve("dist/cli.js");
		fs.mkdirSync(nested, { recursive: true });
		spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
		fs.writeFileSync(path.join(root, "source.ts"), "export const value = 1;\n");
		const result = spawnSync(
			process.execPath,
			[cli, "hook", "install", "--claude", "--project", "--quality-gate", "--absolute", "--yes"],
			{ cwd: nested, env: { ...process.env, HOME: home, AISLOP_TELEMETRY: "0" }, encoding: "utf8" },
		);
		expect(result.status).toBe(0);
		for (const file of [
			".claude/settings.json",
			".aislop/hook-runtime.json",
			".aislop/baseline.json",
		])
			expect(fs.existsSync(path.join(root, file))).toBe(true);
		expect(fs.existsSync(path.join(nested, ".claude/settings.json"))).toBe(false);
		expect(fs.existsSync(path.join(nested, ".aislop/hook-runtime.json"))).toBe(false);
		expect(fs.existsSync(path.join(nested, ".aislop/baseline.json"))).toBe(false);
	});

	it("U7 built CLI doctor root: reports a root install from a nested directory", () => {
		const root = tempDir();
		const nested = path.join(root, "src", "deep");
		const home = tempDir();
		const cli = path.resolve("dist/cli.js");
		fs.mkdirSync(nested, { recursive: true });
		spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
		fs.writeFileSync(path.join(root, "source.ts"), "export const value = 1;\n");
		execFileSync(
			process.execPath,
			[cli, "hook", "install", "--claude", "--project", "--quality-gate", "--absolute", "--yes"],
			{ cwd: root, env: { ...process.env, HOME: home, AISLOP_TELEMETRY: "0" }, encoding: "utf8" },
		);
		const result = spawnSync(process.execPath, [cli, "hook", "doctor", "--project"], {
			cwd: nested,
			env: { ...process.env, HOME: home, AISLOP_TELEMETRY: "0" },
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("runtime: ok");
		expect(result.stdout).toContain("baseline: ok");
	});

	it("U5 built CLI: puts the quoted runtime command in regression feedback", () => {
		const cwd = tempDir();
		const cli = path.resolve("dist/cli.js");
		const file = path.join(cwd, "regression.ts");
		fs.mkdirSync(path.join(cwd, ".aislop"), { recursive: true });
		fs.writeFileSync(file, "export const value = 1;\n");
		fs.writeFileSync(
			path.join(cwd, ".aislop", "baseline.json"),
			JSON.stringify({ schema: "aislop.baseline.v2", score: 101, findingFingerprints: [] }),
		);
		fs.writeFileSync(
			path.join(cwd, ".aislop", "session.jsonl"),
			`${JSON.stringify({ files: [file] })}\n`,
		);
		const fixture = JSON.parse(
			fs.readFileSync(
				path.join("tests", "hooks", "fixtures", "copilot-A-regression-Stop.json"),
				"utf8",
			),
		)[0];
		fixture.cwd = cwd;
		const output = execFileSync(process.execPath, [cli, "hook", "claude", "--stop"], {
			encoding: "utf8",
			input: JSON.stringify(fixture),
			env: { ...process.env, HOME: tempDir() },
		});
		const envelope = JSON.parse(output);
		const feedback = JSON.parse(envelope.hookSpecificOutput.additionalContext);
		const verify = feedback.suggestedActions.find(
			(action: { id: string }) => action.id === "verify_fix",
		);
		expect(verify.command.startsWith(`'${fs.realpathSync(process.execPath)}'`)).toBe(true);
		expect(verify.command).toContain(`'${fs.realpathSync(cli)}'`);
		expect(verify.command.endsWith("scan --changes")).toBe(true);
	});
});
