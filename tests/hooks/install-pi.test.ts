import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	installPi,
	PI_EXTENSION_SOURCE,
	resolvePiPaths,
	uninstallPi,
} from "../../src/hooks/install/pi.js";

let home: string;
let cwd: string;

beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-home-"));
	cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-cwd-"));
});

afterEach(() => {
	fs.rmSync(home, { recursive: true, force: true });
	fs.rmSync(cwd, { recursive: true, force: true });
});

type PiCallback = (
	event: { toolName: string; isError: boolean; input: Record<string, unknown>; content: unknown[] },
	context: { cwd: string; signal: AbortSignal },
) => Promise<any>;

const child = (stdout = '{"message":"found"}', code = 0) => {
	const result = new EventEmitter() as any;
	result.stdout = new EventEmitter();
	result.stdin = new EventEmitter() as any;
	result.stdin.end = vi.fn(() => queueMicrotask(() => {
		if (stdout) result.stdout.emit("data", Buffer.from(stdout));
		result.emit("close", code);
	}));
	result.kill = vi.fn();
	return result;
};

const loadExtension = async (spawn: any): Promise<PiCallback> => {
	(globalThis as any).__aislopSpawn = spawn;
	const source = PI_EXTENSION_SOURCE.replace(
		'import os from "node:os";',
		"const os = { homedir: () => globalThis.__aislopHome };",
	);
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Math.random()}`;
	const extensionModule = (await import(moduleUrl)) as {
		default: (pi: { on: (event: string, handler: PiCallback) => void }) => void;
	};
	let callback: PiCallback | undefined;
	extensionModule.default({ on: (_event, handler) => { callback = handler; } });
	if (!callback) throw new Error("Pi extension did not register its hook");
	return callback;
};

const writeRuntime = (dir: string, nodePath: string, cliPath: string, schema = 1) => {
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

const event = (input: Record<string, unknown> = { path: "src/app.ts" }) =>
	({ toolName: "edit", isError: false, input, content: [] });

const context = (directory = cwd) => ({ cwd: directory, signal: new AbortController().signal });

describe("PI_EXTENSION_SOURCE", () => {
	afterEach(() => {
		delete (globalThis as any).__aislopSpawn;
		delete (globalThis as any).__aislopHome;
		vi.unstubAllEnvs();
	});

	it("subscribes to tool_result and shells out to aislop hook pi", () => {
		expect(PI_EXTENSION_SOURCE).toContain('pi.on("tool_result"');
		expect(PI_EXTENSION_SOURCE).toContain('["hook", "pi"]');
		expect(PI_EXTENSION_SOURCE).toContain("AISLOP_BIN");
	});

	it("uses AISLOP_BIN before a valid runtime file with only hook and agent arguments", async () => {
		const runtime = createRuntimePaths(cwd, "override");
		writeRuntime(cwd, runtime.nodePath, runtime.cliPath);
		vi.stubEnv("AISLOP_BIN", "/override/aislop");
		const spawn = vi.fn(() => child());
		const callback = await loadExtension(spawn);
		await callback(event(), context());
		expect(spawn).toHaveBeenCalledWith("/override/aislop", ["hook", "pi"], expect.any(Object));
	});

	it("uses the valid project runtime before the valid home runtime", async () => {
		const project = createRuntimePaths(cwd, "project");
		const global = createRuntimePaths(home, "home");
		writeRuntime(cwd, project.nodePath, project.cliPath);
		writeRuntime(home, global.nodePath, global.cliPath);
		(globalThis as any).__aislopHome = home;
		const spawn = vi.fn(() => child());
		const callback = await loadExtension(spawn);
		await callback(event(), context());
		expect(spawn).toHaveBeenCalledWith(project.nodePath, [project.cliPath, "hook", "pi"], expect.any(Object));
	});

	it("falls through for schema 2 with existing runtime paths", async () => {
		const runtime = createRuntimePaths(cwd, "schema-two");
		writeRuntime(cwd, runtime.nodePath, runtime.cliPath, 2);
		const spawn = vi.fn(() => child());
		const callback = await loadExtension(spawn);
		await callback(event(), context());
		expect(spawn).toHaveBeenCalledWith("aislop", ["hook", "pi"], expect.any(Object));
	});

	it("falls through and reports stale feedback when either runtime path is missing", async () => {
		for (const missing of ["nodePath", "cliPath"] as const) {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-stale-"));
			try {
				const runtime = createRuntimePaths(directory, missing);
				fs.rmSync(runtime[missing]);
				writeRuntime(directory, runtime.nodePath, runtime.cliPath);
				const spawn = vi.fn(() => child());
				const callback = await loadExtension(spawn);
				const result = await callback(event(), context(directory));
				expect(spawn).toHaveBeenCalledWith("aislop", ["hook", "pi"], expect.any(Object));
				expect(result.content.at(-1)).toMatchObject({ text: "aislop: hook runtime stale, run aislop hook install\nfound" });
			} finally {
				fs.rmSync(directory, { recursive: true, force: true });
			}
		}
	});

	it("uses a valid project runtime file before bare aislop", async () => {
		writeRuntime(cwd, process.execPath, import.meta.filename);
		const spawn = vi.fn(() => child());
		const callback = await loadExtension(spawn);
		await callback(event(), context());
		expect(spawn).toHaveBeenCalledWith(process.execPath, [import.meta.filename, "hook", "pi"], expect.any(Object));
	});

	it("uses the global runtime after a missing project runtime file", async () => {
		(globalThis as any).__aislopHome = home;
		writeRuntime(home, process.execPath, import.meta.filename);
		const spawn = vi.fn(() => child());
		const callback = await loadExtension(spawn);
		await callback(event(), context());
		expect(spawn).toHaveBeenCalledWith(process.execPath, [import.meta.filename, "hook", "pi"], expect.any(Object));
	});

	it("falls through for missing and invalid runtime files", async () => {
		(globalThis as any).__aislopHome = home;
		const spawn = vi.fn(() => child());
		let callback = await loadExtension(spawn);
		await callback(event(), context());
		expect(spawn.mock.calls[0][0]).toBe("aislop");
		fs.mkdirSync(path.join(cwd, ".aislop"), { recursive: true });
		fs.writeFileSync(path.join(cwd, ".aislop", "hook-runtime.json"), "not json");
		callback = await loadExtension(spawn);
		await callback(event(), context());
		expect(spawn.mock.calls[1][0]).toBe("aislop");
	});

	it("delivers stale feedback for failed, empty, and normal fallback output", async () => {
		writeRuntime(cwd, "/missing/node", "/missing/cli.js");
		const failed = child('{"message":"ignored"}', 1);
		const empty = child("");
		const normal = child('{"message":"found"}');
		const spawn = vi.fn().mockReturnValueOnce(failed).mockReturnValueOnce(empty).mockReturnValueOnce(normal);
		const callback = await loadExtension(spawn);
		for (const expected of ["aislop: hook runtime stale, run aislop hook install", "aislop: hook runtime stale, run aislop hook install", "aislop: hook runtime stale, run aislop hook install\nfound"]) {
			const result = await callback(event(), context());
			expect(result.content.at(-1)).toMatchObject({ text: expected });
		}
		expect(spawn.mock.calls.every(([bin]: [string]) => bin === "aislop")).toBe(true);
	});

	it("reads event.input.path instead of another input key", async () => {
		const spawned = child();
		const callback = await loadExtension(vi.fn(() => spawned));
		await callback(event({ path: "src/right.ts", file: "src/wrong.ts" }), context());
		expect(JSON.parse(spawned.stdin.end.mock.calls[0][0]).file_path).toBe("src/right.ts");
	});

	it("clears its timeout when the child cannot spawn", async () => {
		const callback = await loadExtension(vi.fn(() => { throw new Error("spawn failed"); }));
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			await callback(event(), context());
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("installPi", () => {
	it("writes the extension to the global pi extensions dir", () => {
		const opts = { home, cwd, scope: "global" as const };
		installPi(opts);
		const paths = resolvePiPaths(opts);
		expect(paths.extension).toBe(path.join(home, ".pi", "agent", "extensions", "aislop.js"));
		expect(fs.readFileSync(paths.extension, "utf-8")).toBe(PI_EXTENSION_SOURCE);
	});

	it("writes the extension to the project .pi dir in project scope", () => {
		const opts = { home, cwd, scope: "project" as const };
		installPi(opts);
		const paths = resolvePiPaths(opts);
		expect(paths.extension).toBe(path.join(cwd, ".pi", "extensions", "aislop.js"));
		expect(fs.existsSync(paths.extension)).toBe(true);
	});

	it("uninstalls cleanly", () => {
		const opts = { home, cwd, scope: "global" as const };
		installPi(opts);
		const paths = resolvePiPaths(opts);
		expect(fs.existsSync(paths.extension)).toBe(true);
		uninstallPi(opts);
		expect(fs.existsSync(paths.extension)).toBe(false);
	});
});
