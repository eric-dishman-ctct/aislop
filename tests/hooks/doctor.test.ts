import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hookStatus, renderHookStatus } from "../../src/commands/hook.js";
import {
	hookDoctorRuntime,
	type ManagedEntry,
	renderHookDoctor,
	runHookDoctor,
	runHookDoctorEntry,
} from "../../src/hooks/doctor.js";
import { installClaude } from "../../src/hooks/install/claude.js";
import { installOpenCode } from "../../src/hooks/install/opencode.js";
import { installPi } from "../../src/hooks/install/pi.js";
import { resolveHookRuntime } from "../../src/hooks/runtime/resolve.js";
import { resolveInstallIdPath } from "../../src/telemetry/identity.js";
import { APP_VERSION } from "../../src/version.js";

const builtCli = path.resolve("dist/cli.js");
const dirs: string[] = [];
const temp = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-doctor-"));
	dirs.push(dir);
	return dir;
};
const recursiveFiles = (dir: string, root = dir): string[] => {
	const files: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) files.push(...recursiveFiles(entryPath, root));
		else files.push(path.relative(root, entryPath));
	}
	return files.sort();
};
const probe = (cliPath = path.resolve("dist/cli.js")) =>
	`console.log(JSON.stringify({schema:"aislop.hook.probe.v1",version:"${APP_VERSION}",cliPath:"${cliPath}"}))`;
const executableProbe = (cliPath?: string): ManagedEntry => ({
	eventGroup: "PostToolUse",
	exec: process.execPath,
	args: ["-e", probe(cliPath), "--"],
});
const writeRuntime = (dir: string, value: Record<string, unknown>) => {
	fs.mkdirSync(path.join(dir, ".aislop"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".aislop", "hook-runtime.json"), JSON.stringify(value));
};
const writeManagedClaude = (home: string, command: string) => {
	const settings = path.join(home, ".claude", "settings.json");
	fs.mkdirSync(path.dirname(settings), { recursive: true });
	fs.writeFileSync(
		settings,
		JSON.stringify({
			hooks: { PostToolUse: [{ hooks: [{ command, __aislop: { managed: true } }] }] },
		}),
	);
};

afterEach(() => {
	for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	delete process.env.AISLOP_BIN;
});

describe("hook doctor", () => {
	it("runs a managed command and reads its probe envelope", async () => {
		const home = temp();
		const cwd = temp();
		writeManagedClaude(
			home,
			`${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve("dist/cli.js"))} hook claude`,
		);
		const report = await runHookDoctor({ global: true, home, cwd });
		expect(report.entries).toHaveLength(1);
		expect(report.entries[0]).toMatchObject({ started: true, delivered: true, timedOut: false });
	});

	it("distinguishes started, delivered, and failed spawn", async () => {
		const empty = await runHookDoctorEntry({
			eventGroup: "PostToolUse",
			exec: process.execPath,
			args: ["-e", "", "--"],
		});
		const delivered = await runHookDoctorEntry(executableProbe());
		const failed = await runHookDoctorEntry({
			eventGroup: "PostToolUse",
			exec: "/missing/aislop",
			args: [],
		});
		expect(empty).toMatchObject({ started: true, delivered: false });
		expect(delivered).toMatchObject({ started: true, delivered: true });
		expect(failed).toMatchObject({ started: false, delivered: false });
	});

	it("kills a hung managed command at the supplied timeout", async () => {
		const result = await runHookDoctorEntry(
			{
				eventGroup: "PostToolUse",
				exec: process.execPath,
				args: ["-e", "setTimeout(()=>{},60000)", "--"],
			},
			20,
		);
		expect(result).toMatchObject({
			started: true,
			delivered: false,
			timedOut: true,
			exitCode: null,
		});
	});

	it("reports stale runtime paths and a version mismatch", () => {
		const home = temp();
		const cwd = temp();
		writeRuntime(home, {
			schema: 1,
			nodePath: "/missing/node",
			cliPath: path.resolve("dist/cli.js"),
			version: APP_VERSION,
			writtenAt: "now",
		});
		writeRuntime(cwd, {
			schema: 1,
			nodePath: process.execPath,
			cliPath: "/missing/cli",
			version: APP_VERSION,
			writtenAt: "now",
		});
		expect(hookDoctorRuntime("global", home, cwd).status).toBe("stale");
		expect(hookDoctorRuntime("project", home, cwd).status).toBe("stale");
		writeRuntime(cwd, {
			schema: 1,
			nodePath: process.execPath,
			cliPath: path.resolve("dist/cli.js"),
			version: "old",
			writtenAt: "now",
		});
		expect(hookDoctorRuntime("project", home, cwd).status).toBe("stale");
	});

	it("reports a probe from another cli path as a provenance mismatch", async () => {
		const result = await runHookDoctorEntry(executableProbe("/other/cli.js"));
		expect(result).toMatchObject({ delivered: true, provenanceMismatch: true });
	});

	it("uses the doctor runtime status for the status marker", () => {
		const home = temp();
		const cwd = temp();
		writeRuntime(home, {
			schema: 1,
			nodePath: "/missing/node",
			cliPath: "/missing/cli",
			version: APP_VERSION,
			writtenAt: "now",
		});
		const doctor = hookDoctorRuntime("global", home, cwd);
		const output = renderHookStatus([
			{
				agent: "claude",
				scope: "global",
				installed: true,
				paths: [],
				stale: doctor.status === "stale",
			},
		]);
		expect(doctor.status).toBe("stale");
		expect(output).toContain("stale");
	});

	it("drives installed plugin handlers and reports branch, argv, and stale feedback", async () => {
		const home = temp();
		const cwd = temp();
		installPi({ home, cwd, scope: "project", qualityGate: false });
		installOpenCode({ home, cwd, scope: "project", qualityGate: false });
		writeRuntime(cwd, {
			schema: 1,
			nodePath: "/missing/node",
			cliPath: "/missing/cli",
			version: APP_VERSION,
			writtenAt: "now",
		});
		const report = await runHookDoctor({ project: true, home, cwd });
		const plugins = report.entries.filter((entry) => entry.eventGroup === "plugin");
		expect(plugins).toHaveLength(2);
		for (const entry of plugins)
			expect(entry).toMatchObject({
				branch: "bare",
				started: false,
				delivered: false,
				exitCode: 1,
				staleLineDelivered: true,
				argv: ["aislop", "hook", entry.host, "--doctor-probe"],
			});
		writeRuntime(cwd, {
			schema: 1,
			nodePath: process.execPath,
			cliPath: builtCli,
			version: APP_VERSION,
			writtenAt: "now",
		});
		const delivered = (await runHookDoctor({ project: true, home, cwd })).entries;
		for (const entry of delivered)
			expect(entry).toMatchObject({
				started: true,
				delivered: true,
				version: APP_VERSION,
				cliPath: builtCli,
			});
	});

	it("reports each plugin resolution branch from its generated handler", async () => {
		const home = temp();
		const cwd = temp();
		installPi({ home, cwd, scope: "project", qualityGate: false });
		const oldHome = process.env.HOME;
		process.env.HOME = home;
		try {
			process.env.AISLOP_BIN = "/override/aislop";
			let report = await runHookDoctor({ project: true, home, cwd });
			expect(report.entries[0]).toMatchObject({
				branch: "AISLOP_BIN",
				argv: ["/override/aislop", "hook", "pi", "--doctor-probe"],
			});
			delete process.env.AISLOP_BIN;
			writeRuntime(cwd, {
				schema: 1,
				nodePath: process.execPath,
				cliPath: path.resolve("dist/cli.js"),
				version: APP_VERSION,
				writtenAt: "now",
			});
			report = await runHookDoctor({ project: true, home, cwd });
			expect(report.entries[0]).toMatchObject({
				branch: "runtime-project",
				started: true,
				delivered: true,
				version: APP_VERSION,
				cliPath: path.resolve("dist/cli.js"),
			});
			fs.rmSync(path.join(cwd, ".aislop"), { recursive: true });
			writeRuntime(home, {
				schema: 1,
				nodePath: process.execPath,
				cliPath: path.resolve("dist/cli.js"),
				version: APP_VERSION,
				writtenAt: "now",
			});
			report = await runHookDoctor({ project: true, home, cwd });
			expect(report.entries[0]).toMatchObject({ branch: "runtime-global" });
		} finally {
			process.env.HOME = oldHome;
		}
	});

	it("pins doctor exit codes for healthy, failed, and absent hooks", () => {
		const home = temp();
		const cwd = temp();
		const cli = path.resolve("dist/cli.js");
		const run = () =>
			spawnSync(process.execPath, [cli, "hook", "doctor", "--global", "--json"], {
				cwd,
				env: { ...process.env, HOME: home, AISLOP_TELEMETRY: "0" },
				encoding: "utf8",
			});
		expect(run().status).toBe(2);
		writeManagedClaude(
			home,
			`${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} hook claude`,
		);
		expect(run().status).toBe(0);
		writeManagedClaude(
			home,
			`${JSON.stringify(process.execPath)} -e ${JSON.stringify(`${probe()};process.exit(7)`)} --`,
		);
		const envelopeExit = run();
		expect(envelopeExit.status).toBe(1);
		expect(JSON.parse(envelopeExit.stdout).entries[0]).toMatchObject({
			started: true,
			exitCode: 7,
			delivered: false,
		});
		writeManagedClaude(home, "'/missing/aislop' hook claude");
		expect(run().status).toBe(1);
		writeRuntime(home, {
			schema: 1,
			nodePath: "/missing/node",
			cliPath: "/missing/cli",
			version: APP_VERSION,
			writtenAt: "now",
		});
		expect(run().status).toBe(1);
	});

	it("marks only installed agents stale through the real status path", async () => {
		const home = temp();
		const cwd = temp();
		installPi({ home, cwd, scope: "project", qualityGate: false });
		writeManagedClaude(home, "aislop hook claude");
		writeRuntime(home, {
			schema: 1,
			nodePath: "/missing/node",
			cliPath: "/missing/cli",
			version: APP_VERSION,
			writtenAt: "now",
		});
		const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		vi.spyOn(os, "homedir").mockReturnValue(home);
		vi.spyOn(process, "cwd").mockReturnValue(cwd);
		await hookStatus();
		const text = output.mock.calls.map(([value]) => String(value)).join("");
		const rowFor = (agent: string) =>
			text.match(new RegExp(`[✓·] ${agent}[\\s\\S]*?(?=\\n[✓·] |$)`))?.[0] ?? "";
		expect(rowFor("claude")).toMatch(/Status\s+stale/);
		expect(rowFor("cursor")).toMatch(/Status\s+not installed/);
		expect(rowFor("cursor")).not.toMatch(/Status\s+stale/);
		expect(rowFor("codex")).toMatch(/Status\s+not installed/);
		expect(rowFor("codex")).not.toMatch(/Status\s+stale/);
	});

	it("does not report a matching runtime as stale", () => {
		const home = temp();
		const cwd = temp();
		const runtime = resolveHookRuntime();
		writeRuntime(home, { schema: 1, ...runtime, writtenAt: "now" });
		expect(hookDoctorRuntime("global", home, cwd).status).toBe("ok");
	});

	it("rejects a wrong probe schema and skips unmanaged entries", async () => {
		const wrongSchema = await runHookDoctorEntry({
			eventGroup: "PostToolUse",
			exec: process.execPath,
			args: ["-e", 'console.log(JSON.stringify({schema:"wrong",version:"x",cliPath:"x"}))', "--"],
		});
		expect(wrongSchema.delivered).toBe(false);
		const home = temp();
		const cwd = temp();
		const settings = path.join(home, ".claude", "settings.json");
		fs.mkdirSync(path.dirname(settings), { recursive: true });
		fs.writeFileSync(
			settings,
			JSON.stringify({
				hooks: {
					PostToolUse: [
						{
							hooks: [
								{ command: "definitely-not-a-command" },
								{
									command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(probe())}`,
									__aislop: { managed: true },
								},
							],
						},
					],
				},
			}),
		);
		const report = await runHookDoctor({ global: true, home, cwd });
		expect(report.entries).toHaveLength(1);
	});

	it("reports failed plugin probes with their actual exit code", async () => {
		const home = temp();
		const cwd = temp();
		installPi({ home, cwd, scope: "project", qualityGate: false });
		installOpenCode({ home, cwd, scope: "project", qualityGate: false });
		process.env.AISLOP_BIN = "/missing/aislop";
		const entries = (await runHookDoctor({ project: true, home, cwd })).entries;
		expect(entries).toHaveLength(2);
		for (const entry of entries)
			expect(entry).toMatchObject({ started: false, delivered: false, exitCode: 1 });
	});

	it("reports the baseline state for Stop hooks and does not require it without one", async () => {
		const home = temp();
		const cwd = temp();
		installClaude({ home, cwd, scope: "project", qualityGate: true });
		let report = await runHookDoctor({ project: true, home, cwd });
		expect(report.baseline).toEqual([{ scope: "project", status: "missing" }]);
		expect(renderHookDoctor(report, false)).toContain(
			"baseline: missing, quality gate inactive, run aislop hook install --quality-gate or aislop hook baseline",
		);
		fs.mkdirSync(path.join(cwd, ".aislop"), { recursive: true });
		fs.writeFileSync(
			path.join(cwd, ".aislop", "baseline.json"),
			JSON.stringify({ schema: "aislop.baseline.v2", score: 88 }),
		);
		report = await runHookDoctor({ project: true, home, cwd });
		expect(report.baseline).toEqual([{ scope: "project", status: "ok", score: 88 }]);
		installClaude({ home, cwd, scope: "project", qualityGate: false });
		report = await runHookDoctor({ project: true, home, cwd });
		expect(report.baseline).toEqual([{ scope: "project", status: "not-required" }]);
	});

	it("uses the project-root baseline when the doctor runs from a nested directory", () => {
		const home = temp();
		const root = temp();
		const cwd = path.join(root, "nested");
		fs.mkdirSync(path.join(root, ".git"), { recursive: true });
		fs.mkdirSync(cwd, { recursive: true });
		installClaude({ home, cwd: root, scope: "project", absolute: true, qualityGate: true });
		const settings = path.join(root, ".claude", "settings.json");
		const installed = JSON.parse(fs.readFileSync(settings, "utf8")) as {
			hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
		};
		for (const [event, groups] of Object.entries(installed.hooks))
			groups[0].hooks[0].command = `${JSON.stringify(process.execPath)} ${JSON.stringify(builtCli)} hook claude${event === "Stop" ? " --stop" : ""}`;
		fs.writeFileSync(settings, JSON.stringify(installed));
		fs.mkdirSync(path.join(root, ".aislop"), { recursive: true });
		fs.writeFileSync(
			path.join(root, ".aislop", "baseline.json"),
			JSON.stringify({ schema: "aislop.baseline.v2", score: 88 }),
		);
		const result = spawnSync(
			process.execPath,
			[builtCli, "hook", "doctor", "--project", "--json"],
			{
				cwd,
				env: { ...process.env, HOME: home, AISLOP_TELEMETRY: "0" },
				encoding: "utf8",
			},
		);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout).baseline).toEqual([
			{ scope: "project", status: "ok", score: 88 },
		]);
	});

	it("exits one for a missing baseline and zero when it is present or not required", () => {
		const home = temp();
		const cwd = temp();
		const settings = path.join(cwd, ".claude", "settings.json");
		fs.mkdirSync(path.dirname(settings), { recursive: true });
		fs.writeFileSync(
			settings,
			JSON.stringify({
				hooks: {
					PostToolUse: [
						{
							hooks: [
								{
									command: `${JSON.stringify(process.execPath)} ${JSON.stringify(builtCli)} hook claude`,
									__aislop: { managed: true },
								},
							],
						},
					],
					Stop: [
						{
							hooks: [
								{
									command: `${JSON.stringify(process.execPath)} ${JSON.stringify(builtCli)} hook claude --stop`,
									__aislop: { managed: true },
								},
							],
						},
					],
				},
			}),
		);
		const run = () =>
			spawnSync(process.execPath, [builtCli, "hook", "doctor", "--project", "--json"], {
				cwd,
				env: { ...process.env, HOME: home, AISLOP_TELEMETRY: "0" },
				encoding: "utf8",
			});
		const missing = run();
		expect(missing.status).toBe(1);
		expect(JSON.parse(missing.stdout).baseline).toEqual([{ scope: "project", status: "missing" }]);
		fs.mkdirSync(path.join(cwd, ".aislop"), { recursive: true });
		fs.writeFileSync(
			path.join(cwd, ".aislop", "baseline.json"),
			JSON.stringify({ schema: "aislop.baseline.v2", score: 88 }),
		);
		expect(run().status).toBe(0);
		fs.writeFileSync(
			settings,
			JSON.stringify({
				hooks: {
					PostToolUse: [
						{
							hooks: [
								{
									command: `${JSON.stringify(process.execPath)} ${JSON.stringify(builtCli)} hook claude`,
									__aislop: { managed: true },
								},
							],
						},
					],
				},
			}),
		);
		expect(run().status).toBe(0);
	});

	it("uses the default timeout and kills the child at 10000 ms", async () => {
		vi.useFakeTimers();
		const child = new (await import("node:events")).EventEmitter() as any;
		child.stdin = new (await import("node:events")).EventEmitter();
		child.stdout = new (await import("node:events")).EventEmitter();
		child.stdin.end = () => {};
		child.kill = vi.fn();
		const result = runHookDoctorEntry(
			{ eventGroup: "test", exec: "fake", args: [] },
			undefined,
			() => child,
		);
		await vi.advanceTimersByTimeAsync(9999);
		expect(child.kill).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(child.kill).toHaveBeenCalledTimes(1);
		await expect(result).resolves.toMatchObject({ timedOut: true });
		vi.useRealTimers();
	});

	it("keeps built probes inert with telemetry live and creates identity for a normal hook", () => {
		const home = temp();
		const cwd = temp();
		const env = {
			...process.env,
			HOME: home,
			XDG_STATE_HOME: path.join(home, "state"),
			AISLOP_TELEMETRY_DRY_RUN: "1",
		};
		for (const key of ["CI", "AISLOP_NO_TELEMETRY", "DO_NOT_TRACK", "AISLOP_BIN"]) delete env[key];
		const identity = resolveInstallIdPath(home, env);
		for (const agent of ["claude", "pi", "opencode"]) {
			const homeFiles = recursiveFiles(home);
			const projectFiles = recursiveFiles(cwd);
			const probeResult = spawnSync(process.execPath, [builtCli, "hook", agent, "--doctor-probe"], {
				cwd,
				env,
				encoding: "utf8",
			});
			expect(probeResult.status).toBe(0);
			expect(recursiveFiles(home)).toEqual(homeFiles);
			expect(recursiveFiles(cwd)).toEqual(projectFiles);
		}
		expect(fs.existsSync(identity)).toBe(false);
		const hookResult = spawnSync(process.execPath, [builtCli, "hook", "claude"], {
			cwd,
			input: "{}",
			env,
			encoding: "utf8",
		});
		expect(hookResult.status).toBe(0);
		expect(fs.existsSync(identity)).toBe(true);
	});
});
