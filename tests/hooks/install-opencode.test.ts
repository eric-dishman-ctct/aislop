import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	installOpenCode,
	OPENCODE_PLUGIN_SOURCE,
	resolveOpenCodePaths,
	uninstallOpenCode,
} from "../../src/hooks/install/opencode.js";

type Handler = (event: any) => Promise<void>;

const fixture = JSON.parse(
	fs.readFileSync(path.join(import.meta.dirname, "fixtures", "opencode-patch-event.json"), "utf8"),
)[0].event;

const loadPlugin = async (spawn: any) => {
	const source = OPENCODE_PLUGIN_SOURCE.replace(
		'import { Plugin } from "@opencode/plugin";',
		"const Plugin = { define: (value: any) => value };",
	).replace(
		'import os from "node:os";',
		"const os = { homedir: () => globalThis.__aislopHome };",
	).replace("globalThis.__aislopSpawn || spawn", "globalThis.__aislopSpawn || spawn");
	(globalThis as any).__aislopSpawn = spawn;
	const output = ts.transpileModule(source, {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
	}).outputText;
	return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}#${Math.random()}`);
};

const child = (stdout = '{"message":"found"}', code = 0) => {
	const result = new EventEmitter() as any;
	result.stdout = new EventEmitter();
	result.stdin = new EventEmitter() as any;
	result.stdin.destroyed = false;
	result.stdin.end = vi.fn(() => {
		queueMicrotask(() => {
			result.stdout.emit("data", Buffer.from(stdout));
			result.emit("close", code);
		});
	});
	result.kill = vi.fn();
	return result;
};

const writeRuntime = (dir: string, nodePath: string, cliPath: string, schema = 1): void => {
	fs.mkdirSync(path.join(dir, ".aislop"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".aislop", "hook-runtime.json"), JSON.stringify({ schema, nodePath, cliPath }));
};

const createRuntimePaths = (dir: string, name: string) => {
	const nodePath = path.join(dir, `${name}-node`);
	const cliPath = path.join(dir, `${name}-cli.js`);
	fs.writeFileSync(nodePath, "");
	fs.writeFileSync(cliPath, "");
	return { nodePath, cliPath };
};

const setupPlugin = async (spawn: any, directory: string) => {
	const plugin: any = await loadPlugin(spawn);
	const hooks: Record<string, Handler> = {};
	await plugin.default.setup({
		location: { directory },
		tool: { hook: async (name: string, handler: Handler) => void (hooks[name] = handler) },
		session: { hook: async (name: string, handler: Handler) => void (hooks[name] = handler) },
	});
	return hooks;
};

const assertCaptureFixture = (capture: unknown): void => {
	expect(Array.isArray(capture)).toBe(true);
	if (!Array.isArray(capture)) return;
	expect(capture.length).toBeGreaterThan(0);
	expect(capture[0]).toMatchObject({ event: { tool: expect.any(String) } });
};

describe("OpenCode runtime plugin", () => {
	afterEach(() => {
		delete (globalThis as any).__aislopSpawn;
		delete (globalThis as any).__aislopHome;
		vi.unstubAllEnvs();
		vi.useRealTimers();
	});

	it("accepts the captured patch event fixture", () => {
		assertCaptureFixture(
			JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", "opencode-patch-event.json"), "utf8")),
		);
	});

	it("registers hooks, scans completed file tools once, and delivers session feedback", async () => {
		const spawned = child();
		const spawn = vi.fn(() => spawned);
		const plugin: any = await loadPlugin(spawn);
		const hooks: Record<string, Handler> = {};
		await plugin.default.setup({
			location: { directory: "/repo" },
			tool: { hook: async (name: string, handler: Handler) => void (hooks[name] = handler) },
			session: { hook: async (name: string, handler: Handler) => void (hooks[name] = handler) },
		});
		expect(Object.keys(hooks).sort()).toEqual(["context", "execute.after"]);
		await hooks["execute.after"](fixture);
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(spawn.mock.calls[0][1]).toEqual(["hook", "opencode"]);
		expect(spawn.mock.calls[0][2]).toMatchObject({ cwd: "/repo", stdio: ["pipe", "pipe", "ignore"] });
		expect(JSON.parse(spawned.stdin.end.mock.calls[0][0])).toMatchObject({
			cwd: "/repo",
			file_paths: [fixture.result.output.applied[0].target],
			tool_name: fixture.tool,
		});
		const messages: any[] = [];
		await hooks.context({ sessionID: fixture.sessionID, messages });
		expect(messages).toEqual([{ role: "user", content: [{ type: "text", text: "AISLOP FEEDBACK:\nfound" }] }]);
		await hooks.context({ sessionID: fixture.sessionID, messages });
		expect(messages).toHaveLength(1);
	});

	it("uses AISLOP_BIN before a valid runtime file with only hook and agent arguments", async () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-opencode-"));
		try {
			const runtime = createRuntimePaths(directory, "override");
			writeRuntime(directory, runtime.nodePath, runtime.cliPath);
			vi.stubEnv("AISLOP_BIN", "/override/aislop");
			const spawn = vi.fn(() => child());
			const hooks = await setupPlugin(spawn, directory);
			await hooks["execute.after"]({ tool: "edit", status: "completed", sessionID: "one", input: { path: "a.ts" }, result: { output: {} } });
			expect(spawn).toHaveBeenCalledWith("/override/aislop", ["hook", "opencode"], expect.any(Object));
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it("uses the valid project runtime before the valid home runtime", async () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-opencode-"));
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-home-"));
		try {
			const project = createRuntimePaths(directory, "project");
			const global = createRuntimePaths(home, "home");
			writeRuntime(directory, project.nodePath, project.cliPath);
			writeRuntime(home, global.nodePath, global.cliPath);
			(globalThis as any).__aislopHome = home;
			const spawn = vi.fn(() => child());
			const hooks = await setupPlugin(spawn, directory);
			await hooks["execute.after"]({ tool: "edit", status: "completed", sessionID: "one", input: { path: "a.ts" }, result: { output: {} } });
			expect(spawn).toHaveBeenCalledWith(project.nodePath, [project.cliPath, "hook", "opencode"], expect.any(Object));
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	it("falls through for schema 2 with existing runtime paths", async () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-opencode-"));
		try {
			const runtime = createRuntimePaths(directory, "schema-two");
			writeRuntime(directory, runtime.nodePath, runtime.cliPath, 2);
			const spawn = vi.fn(() => child());
			const hooks = await setupPlugin(spawn, directory);
			await hooks["execute.after"]({ tool: "edit", status: "completed", sessionID: "one", input: { path: "a.ts" }, result: { output: {} } });
			expect(spawn).toHaveBeenCalledWith("aislop", ["hook", "opencode"], expect.any(Object));
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it("falls through and reports stale feedback when either runtime path is missing", async () => {
		for (const missing of ["nodePath", "cliPath"] as const) {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-opencode-"));
			try {
				const runtime = createRuntimePaths(directory, missing);
				fs.rmSync(runtime[missing]);
				writeRuntime(directory, runtime.nodePath, runtime.cliPath);
				const spawn = vi.fn(() => child());
				const hooks = await setupPlugin(spawn, directory);
				await hooks["execute.after"]({ tool: "edit", status: "completed", sessionID: missing, input: { path: "a.ts" }, result: { output: {} } });
				expect(spawn).toHaveBeenCalledWith("aislop", ["hook", "opencode"], expect.any(Object));
				const messages: any[] = [];
				await hooks.context({ sessionID: missing, messages });
				expect(messages[0].content[0].text).toBe("AISLOP FEEDBACK:\naislop: hook runtime stale, run aislop hook install\nfound");
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		}
	});

	it("uses a valid project runtime file before bare aislop", async () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-opencode-"));
		try {
			writeRuntime(directory, process.execPath, import.meta.filename);
			const spawn = vi.fn(() => child());
			const hooks = await setupPlugin(spawn, directory);
			await hooks["execute.after"]({ tool: "edit", status: "completed", sessionID: "one", input: { path: "a.ts" }, result: { output: {} } });
			expect(spawn).toHaveBeenCalledWith(process.execPath, [import.meta.filename, "hook", "opencode"], expect.any(Object));
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it("uses the global runtime after a missing project runtime file", async () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-opencode-"));
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-home-"));
		try {
			(globalThis as any).__aislopHome = home;
			writeRuntime(home, process.execPath, import.meta.filename);
			const spawn = vi.fn(() => child());
			const hooks = await setupPlugin(spawn, directory);
			await hooks["execute.after"]({ tool: "edit", status: "completed", sessionID: "one", input: { path: "a.ts" }, result: { output: {} } });
			expect(spawn).toHaveBeenCalledWith(process.execPath, [import.meta.filename, "hook", "opencode"], expect.any(Object));
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	it("falls through for missing and invalid runtime files", async () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-opencode-"));
		try {
			const spawn = vi.fn(() => child());
			let hooks = await setupPlugin(spawn, directory);
			await hooks["execute.after"]({ tool: "edit", status: "completed", sessionID: "one", input: { path: "a.ts" }, result: { output: {} } });
			expect(spawn.mock.calls[0][0]).toBe("aislop");
			fs.mkdirSync(path.join(directory, ".aislop"), { recursive: true });
			fs.writeFileSync(path.join(directory, ".aislop", "hook-runtime.json"), "not json");
			hooks = await setupPlugin(spawn, directory);
			await hooks["execute.after"]({ tool: "edit", status: "completed", sessionID: "two", input: { path: "a.ts" }, result: { output: {} } });
			expect(spawn.mock.calls[1][0]).toBe("aislop");
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it("delivers stale feedback for failed, empty, and normal fallback output", async () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-opencode-"));
		try {
			writeRuntime(directory, "/missing/node", "/missing/cli.js");
			const spawn = vi.fn()
				.mockReturnValueOnce(child('{"message":"ignored"}', 1))
				.mockReturnValueOnce(child(""))
				.mockReturnValueOnce(child('{"message":"found"}'));
			const hooks = await setupPlugin(spawn, directory);
			for (const [sessionID, expected] of [["failed", "aislop: hook runtime stale, run aislop hook install"], ["empty", "aislop: hook runtime stale, run aislop hook install"], ["normal", "aislop: hook runtime stale, run aislop hook install\nfound"]]) {
				await hooks["execute.after"]({ tool: "edit", status: "completed", sessionID, input: { path: "a.ts" }, result: { output: {} } });
				const messages: any[] = [];
				await hooks.context({ sessionID, messages });
				expect(messages[0].content[0].text).toBe(`AISLOP FEEDBACK:\n${expected}`);
			}
			expect(spawn.mock.calls.every(([bin]: [string]) => bin === "aislop")).toBe(true);
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it("uses input.path, ignores other tools and errors, and isolates sessions", async () => {
		const spawn = vi.fn(() => child());
		const plugin: any = await loadPlugin(spawn);
		const hooks: Record<string, Handler> = {};
		await plugin.default.setup({ location: { directory: "/repo" }, tool: { hook: async (n: string, h: Handler) => void (hooks[n] = h) }, session: { hook: async (n: string, h: Handler) => void (hooks[n] = h) } });
		await hooks["execute.after"]({ tool: "edit", status: "completed", sessionID: "one", input: { path: "src/a.ts" }, result: { output: {} } });
		expect(JSON.parse(spawn.mock.results[0].value.stdin.end.mock.calls[0][0]).file_paths).toEqual(["/repo/src/a.ts"]);
		await hooks["execute.after"]({ tool: "read", status: "completed", sessionID: "one", input: { path: "a" }, result: { output: {} } });
		await hooks["execute.after"]({ tool: "edit", status: "error", sessionID: "one", input: { path: "a" } });
		expect(spawn).toHaveBeenCalledTimes(1);
		const other: any[] = [];
		await hooks.context({ sessionID: "other", messages: other });
		expect(other).toEqual([]);
		const own: any[] = [];
		await hooks.context({ sessionID: "one", messages: own });
		expect(own).toHaveLength(1);
	});

	it("does not buffer empty, malformed, failed, or spawn-error output", async () => {
		const blank = child('{"message":"   "}');
		const malformed = child("not json");
		const failed = child('{"message":"found"}', 1);
		const broken = child();
		broken.stdin.end = vi.fn(() => queueMicrotask(() => broken.emit("error", new Error("no spawn"))));
		const spawn = vi.fn().mockReturnValueOnce(blank).mockReturnValueOnce(malformed).mockReturnValueOnce(failed).mockReturnValueOnce(broken);
		const plugin: any = await loadPlugin(spawn);
		const hooks: Record<string, Handler> = {};
		await plugin.default.setup({ location: { directory: "/repo" }, tool: { hook: async (n: string, h: Handler) => void (hooks[n] = h) }, session: { hook: async (n: string, h: Handler) => void (hooks[n] = h) } });
		for (let index = 0; index < 4; index += 1) {
			await expect(hooks["execute.after"]({ tool: "edit", status: "completed", sessionID: "one", input: { path: `a-${index}` }, result: { output: {} } })).resolves.toBeUndefined();
		}
		const messages: any[] = [];
		await hooks.context({ sessionID: "one", messages });
		expect(messages).toEqual([]);
	});

	it("contains spawn, stdin, output, and timeout failures", async () => {
		vi.useFakeTimers();
		const slow = child();
		slow.stdin.end = vi.fn();
		const spawn = vi.fn(() => slow);
		const plugin: any = await loadPlugin(spawn);
		const hooks: Record<string, Handler> = {};
		await plugin.default.setup({ location: { directory: "/repo" }, tool: { hook: async (n: string, h: Handler) => void (hooks[n] = h) }, session: { hook: async (n: string, h: Handler) => void (hooks[n] = h) } });
		const call = hooks["execute.after"]({ tool: "edit", status: "completed", sessionID: "one", input: { path: "a" }, result: { output: {} } });
		await vi.advanceTimersByTimeAsync(7999);
		expect(slow.kill).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(slow.kill).toHaveBeenCalledTimes(1);
		await expect(call).resolves.toBeUndefined();
		const messages: any[] = [];
		await hooks.context({ sessionID: "one", messages });
		expect(messages).toEqual([]);
	});
	it("spawns one child for all patch targets", async () => {
		const spawned = child();
		const spawn = vi.fn(() => spawned);
		const plugin: any = await loadPlugin(spawn);
		const hooks: Record<string, Handler> = {};
		await plugin.default.setup({ location: { directory: "/repo" }, tool: { hook: async (n: string, h: Handler) => void (hooks[n] = h) }, session: { hook: async (n: string, h: Handler) => void (hooks[n] = h) } });
		await hooks["execute.after"]({ tool: "patch", status: "completed", sessionID: "one", result: { output: { applied: [{ target: "src/a.ts" }, { target: "src/b.ts" }] } } });
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(JSON.parse(spawned.stdin.end.mock.calls[0][0]).file_paths).toEqual(["/repo/src/a.ts", "/repo/src/b.ts"]);
	});

	it("contains synchronous spawn failures and leaves no pending feedback", async () => {
		expect(OPENCODE_PLUGIN_SOURCE).toContain("} catch {\n\t\t\tresolveResult(null);");
		const plugin: any = await loadPlugin(vi.fn(() => { throw new Error("spawn failed"); }));
		const hooks: Record<string, Handler> = {};
		await plugin.default.setup({ location: { directory: "/repo" }, tool: { hook: async (n: string, h: Handler) => void (hooks[n] = h) }, session: { hook: async (n: string, h: Handler) => void (hooks[n] = h) } });
		await expect(hooks["execute.after"]({ tool: "edit", status: "completed", sessionID: "one", input: { path: "a.ts" } })).resolves.toBeUndefined();
		const messages: any[] = [];
		await hooks.context({ sessionID: "one", messages });
		expect(messages).toEqual([]);
	});

	it("contains frozen and throwing context messages", async () => {
		const plugin: any = await loadPlugin(vi.fn(() => child()));
		const hooks: Record<string, Handler> = {};
		await plugin.default.setup({ location: { directory: "/repo" }, tool: { hook: async (n: string, h: Handler) => void (hooks[n] = h) }, session: { hook: async (n: string, h: Handler) => void (hooks[n] = h) } });
		await hooks["execute.after"]({ tool: "edit", status: "completed", sessionID: "frozen", input: { path: "a.ts" } });
		await expect(hooks.context({ sessionID: "frozen", messages: Object.freeze([]) })).resolves.toBeUndefined();
		await hooks["execute.after"]({ tool: "edit", status: "completed", sessionID: "getter", input: { path: "a.ts" } });
		await expect(hooks.context({ sessionID: "getter", get messages() { throw new Error("bad messages"); } })).resolves.toBeUndefined();
	});

	it("contains stdin EPIPE errors", async () => {
		const unhandledRejection = vi.fn();
		const uncaughtException = vi.fn();
		process.on("unhandledRejection", unhandledRejection);
		process.on("uncaughtException", uncaughtException);
		try {
			const spawned = child();
			spawned.stdin.end = vi.fn(() => {
				queueMicrotask(() => spawned.stdin.emit("error", new Error("EPIPE")));
			});
			const plugin: any = await loadPlugin(vi.fn(() => spawned));
			const hooks: Record<string, Handler> = {};
			await plugin.default.setup({ location: { directory: "/repo" }, tool: { hook: async (n: string, h: Handler) => void (hooks[n] = h) }, session: { hook: async (n: string, h: Handler) => void (hooks[n] = h) } });
			await expect(hooks["execute.after"]({ tool: "edit", status: "completed", sessionID: "one", input: { path: "a.ts" } })).resolves.toBeUndefined();
			expect(spawned.stdin.listenerCount("error")).toBeGreaterThanOrEqual(1);
			await Promise.resolve();
			expect(unhandledRejection).not.toHaveBeenCalled();
			expect(uncaughtException).not.toHaveBeenCalled();
		} finally {
			process.off("unhandledRejection", unhandledRejection);
			process.off("uncaughtException", uncaughtException);
		}
	});

	it("contains throwing execute-after event access and leaves no pending feedback", async () => {
		const plugin: any = await loadPlugin(vi.fn(() => child()));
		const hooks: Record<string, Handler> = {};
		await plugin.default.setup({ location: { directory: "/repo" }, tool: { hook: async (n: string, h: Handler) => void (hooks[n] = h) }, session: { hook: async (n: string, h: Handler) => void (hooks[n] = h) } });
		const event = {
			tool: "edit",
			status: "completed",
			sessionID: "one",
			input: { path: "a.ts" },
			get result() { throw new Error("bad result"); },
		};
		await expect(hooks["execute.after"](event)).resolves.toBeUndefined();
		const messages: any[] = [];
		await hooks.context({ sessionID: "one", messages });
		expect(messages).toEqual([]);
	});

	it("sweeps expired session feedback", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		const plugin: any = await loadPlugin(vi.fn(() => child()));
		const hooks: Record<string, Handler> = {};
		await plugin.default.setup({ location: { directory: "/repo" }, tool: { hook: async (n: string, h: Handler) => void (hooks[n] = h) }, session: { hook: async (n: string, h: Handler) => void (hooks[n] = h) } });
		await hooks["execute.after"]({ tool: "edit", status: "completed", sessionID: "A", input: { path: "a.ts" } });
		vi.setSystemTime(new Date("2026-01-01T00:11:00Z"));
		await hooks.context({ sessionID: "B", messages: [] });
		const messages: any[] = [];
		await hooks.context({ sessionID: "A", messages });
		expect(messages).toEqual([]);
	});

});

describe("OpenCode installer", () => {
	let home: string;
	let cwd: string;
	beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-home-")); cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-cwd-")); });
	afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(cwd, { recursive: true, force: true }); });
	it("writes only the generated plugin at both scopes and removes only its marker", () => {
		const project = { home, cwd, scope: "project" as const };
		installOpenCode(project);
		const file = resolveOpenCodePaths(project).plugin;
		expect(file).toBe(path.join(cwd, ".opencode", "plugins", "aislop.ts"));
		expect(fs.readFileSync(file, "utf8")).toContain("aislop:generated-opencode");
		uninstallOpenCode(project);
		expect(fs.existsSync(file)).toBe(false);
		const global = { home, cwd, scope: "global" as const };
		installOpenCode(global);
		expect(resolveOpenCodePaths(global).plugin).toBe(path.join(home, ".config", "opencode", "plugins", "aislop.ts"));
	});
});
