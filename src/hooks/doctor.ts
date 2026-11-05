import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import {
	AGENTS_SUPPORTING_BOTH_SCOPES,
	type AgentName,
	ALL_AGENTS,
	REGISTRY,
} from "./install/registry.js";
import { AISLOP_SENTINEL_KEY } from "./io/json-patch.js";
import { resolveHookRoot } from "./io/project-root.js";
import { readBaseline } from "./quality-gate/baseline.js";
import { hookDoctorRuntime } from "./doctor-report.js";
import { resolveHookRuntime } from "./runtime/resolve.js";
import { readHookRuntime } from "./runtime/runtime-file.js";

export { hookDoctorRuntime, renderHookDoctor } from "./doctor-report.js";
const PROBE_SCHEMA = "aislop.hook.probe.v1";
const HOOK_DOCTOR_TIMEOUT_MS = 10_000;
export type Scope = "global" | "project";
type PluginBranch = "AISLOP_BIN" | "runtime-project" | "runtime-global" | "bare";
export type ManagedEntry = { eventGroup: string; command?: string; exec?: string; args?: string[] };
export interface HookDoctorEntry {
	host: AgentName;
	scope: Scope;
	eventGroup: string;
	commandForm: "portable" | "absolute";
	started: boolean;
	exitCode: number | null;
	timedOut: boolean;
	delivered: boolean;
	version?: string;
	nodePath?: string;
	cliPath?: string;
	provenanceMismatch: boolean;
	branch?: PluginBranch;
	argv?: string[];
	staleLineDelivered?: boolean;
	stop?: boolean;
}

export interface HookDoctorRuntime {
	scope: Scope;
	status: "ok" | "missing" | "invalid" | "stale";
	pairMatchesCurrent: boolean;
}

interface HookDoctorBaseline {
	scope: Scope;
	status: "missing" | "ok" | "not-required";
	score?: number;
}

export interface HookDoctorReport {
	entries: HookDoctorEntry[];
	runtime: HookDoctorRuntime[];
	baseline: HookDoctorBaseline[];
}
type SpawnProcess = (
	command: string,
	args: string[],
	options: Parameters<typeof spawn>[2],
) => ReturnType<typeof spawn>;
const spawnProcess: SpawnProcess = (command, args, options) => spawn(command, args, options);

const scopesFor = (agent: AgentName, requested: Scope[]): Scope[] =>
	AGENTS_SUPPORTING_BOTH_SCOPES.includes(agent)
		? requested
		: requested.filter((scope) => scope === "project");

const managedEntries = (value: unknown, eventGroup = "unknown"): ManagedEntry[] => {
	if (!value || typeof value !== "object") return [];
	if (Array.isArray(value)) return value.flatMap((item) => managedEntries(item, eventGroup));
	const record = value as Record<string, unknown>;
	if (
		record[AISLOP_SENTINEL_KEY] &&
		(typeof record.command === "string" || typeof record.exec === "string")
	) {
		return [
			{
				eventGroup,
				command: typeof record.command === "string" ? record.command : undefined,
				exec: typeof record.exec === "string" ? record.exec : undefined,
				args:
					Array.isArray(record.args) && record.args.every((arg) => typeof arg === "string")
						? (record.args as string[])
						: [],
			},
		];
	}
	return Object.entries(record).flatMap(([key, child]) =>
		managedEntries(child, key === "hooks" ? eventGroup : key),
	);
};

const entriesInFile = (file: string): ManagedEntry[] => {
	try {
		return managedEntries(JSON.parse(fs.readFileSync(file, "utf8")));
	} catch {
		return [];
	}
};
export const runHookDoctorEntry = async (
	entry: ManagedEntry,
	timeoutMs = HOOK_DOCTOR_TIMEOUT_MS,
	spawnEntry: SpawnProcess = spawnProcess,
	writeProbePayload = true,
	probeCwd = process.cwd(),
): Promise<Omit<HookDoctorEntry, "host" | "scope" | "eventGroup" | "commandForm">> =>
	new Promise((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = entry.exec
				? spawnEntry(entry.exec, [...(entry.args ?? []), "--doctor-probe"], {
						stdio: ["pipe", "pipe", "ignore"],
					})
				: spawnEntry(`${entry.command ?? ""} --doctor-probe`, [], {
						shell: true,
						stdio: ["pipe", "pipe", "ignore"],
					});
		} catch {
			resolve({
				started: false,
				exitCode: null,
				timedOut: false,
				delivered: false,
				provenanceMismatch: false,
			});
			return;
		}
		let started = true;
		let stdout = "";
		let settled = false;
		let timedOut = false;
		const finish = (exitCode: number | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			let probe: Record<string, unknown> | undefined;
			try {
				probe = JSON.parse(stdout) as Record<string, unknown>;
			} catch {
				/* no probe */
			}
			const delivered =
				exitCode === 0 &&
				probe?.schema === PROBE_SCHEMA &&
				typeof probe.version === "string" &&
				typeof probe.cliPath === "string";
			const current = resolveHookRuntime();
			resolve({
				started,
				exitCode,
				timedOut,
				delivered,
				version: typeof probe?.version === "string" ? probe.version : undefined,
				nodePath: typeof probe?.nodePath === "string" ? probe.nodePath : undefined,
				cliPath: typeof probe?.cliPath === "string" ? probe.cliPath : undefined,
				provenanceMismatch: delivered && probe?.cliPath !== current.cliPath,
			});
		};
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
			finish(null);
		}, timeoutMs);
		child.on("error", () => {
			started = false;
			finish(null);
		});
		child.stdin?.on("error", () => {});
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.on("close", finish);
		if (writeProbePayload)
			child.stdin?.end(
				JSON.stringify({ tool_name: "edit", file_path: "doctor-probe.ts", cwd: probeCwd }),
			);
	});
const pluginBranch = (
	bin: string | undefined,
	args: string[] | undefined,
	home: string,
	cwd: string,
): PluginBranch => {
	if (bin && process.env.AISLOP_BIN === bin) return "AISLOP_BIN";
	const project = readHookRuntime(cwd);
	if (
		project.status === "ok" &&
		bin === project.runtime.nodePath &&
		args?.[0] === project.runtime.cliPath
	)
		return "runtime-project";
	const global = readHookRuntime(home);
	if (
		global.status === "ok" &&
		bin === global.runtime.nodePath &&
		args?.[0] === global.runtime.cliPath
	)
		return "runtime-global";
	return "bare";
};
const runPlugin = async (
	host: "pi" | "opencode",
	file: string,
	scope: Scope,
	home: string,
	cwd: string,
): Promise<HookDoctorEntry> => {
	const calls: Array<{
		bin: string;
		args: string[];
		result: Promise<Omit<HookDoctorEntry, "host" | "scope" | "eventGroup" | "commandForm">>;
	}> = [];
	const runner = (bin: string, args: string[], options: Parameters<typeof spawn>[2]) => {
		const entry: ManagedEntry = { eventGroup: "plugin", exec: bin, args };
		let child: ReturnType<typeof spawn> | undefined;
		const result = runHookDoctorEntry(
			entry,
			HOOK_DOCTOR_TIMEOUT_MS,
			(command, probeArgs, probeOptions) => {
				child = spawn(command, probeArgs, options ?? probeOptions);
				return child;
			},
			false,
		);
		calls.push({ bin, args: [...args, "--doctor-probe"], result });
		return child!;
	};
	const globals = globalThis as Record<string, unknown>;
	const originalSpawn = globals.__aislopSpawn;
	const originalPlugin = globals.__aislopPlugin;
	globals.__aislopSpawn = runner;
	try {
		let source = fs.readFileSync(file, "utf8");
		let staleLineDelivered = false;
		if (host === "pi") {
			let handler: ((event: unknown, context: unknown) => Promise<unknown>) | undefined;
			const plugin = (await import(
				`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#doctor-${Date.now()}`
			)) as { default: (pi: { on: (_name: string, callback: typeof handler) => void }) => void };
			plugin.default({
				on: (_name, callback) => {
					handler = callback;
				},
			});
			const feedback = await handler?.(
				{ toolName: "edit", isError: false, input: { path: "doctor-probe.ts" }, content: [] },
				{ cwd, signal: new AbortController().signal },
			);
			staleLineDelivered = JSON.stringify(feedback ?? "").includes("hook runtime stale");
		} else {
			source = source.replace(
				'import { Plugin } from "@opencode/plugin";',
				"const Plugin = globalThis.__aislopPlugin;",
			);
			globals.__aislopPlugin = { define: (plugin: unknown) => plugin };
			const plugin = (await import(
				`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#doctor-${Date.now()}`
			)) as { default: { setup: (ctx: unknown) => Promise<void> } };
			let handler: ((event: unknown) => Promise<unknown>) | undefined;
			let contextHandler:
				| ((event: { sessionID: string; messages: unknown[] }) => Promise<unknown>)
				| undefined;
			await plugin.default.setup({
				location: { directory: cwd },
				tool: {
					hook: async (_name: string, callback: typeof handler) => {
						handler = callback;
					},
				},
				session: {
					hook: async (_name: string, callback: typeof contextHandler) => {
						contextHandler = callback;
					},
				},
			});
			await handler?.({
				status: "completed",
				tool: "edit",
				input: { path: "doctor-probe.ts" },
				result: { output: { applied: [] } },
				sessionID: "doctor",
			});
			const context = { sessionID: "doctor", messages: [] as unknown[] };
			await contextHandler?.(context);
			staleLineDelivered = JSON.stringify(context).includes("hook runtime stale");
		}
		const call = calls[0];
		const result = call ? await call.result : undefined;
		return {
			host,
			scope,
			eventGroup: "plugin",
			commandForm: call?.bin === "aislop" ? "portable" : "absolute",
			started: result?.started ?? false,
			exitCode: result ? (result.exitCode ?? (result.started ? null : 1)) : null,
			timedOut: result?.timedOut ?? false,
			delivered: result?.delivered ?? false,
			version: result?.version,
			nodePath: result?.nodePath,
			cliPath: result?.cliPath,
			provenanceMismatch: result?.provenanceMismatch ?? false,
			branch: pluginBranch(call?.bin, call?.args, home, cwd),
			argv: call ? [call.bin, ...call.args] : [],
			staleLineDelivered,
			stop: false,
		};
	} catch {
		return {
			host,
			scope,
			eventGroup: "plugin",
			commandForm: "portable",
			started: false,
			exitCode: null,
			timedOut: false,
			delivered: false,
			provenanceMismatch: false,
			branch: "bare",
			argv: [],
			staleLineDelivered: false,
			stop: false,
		};
	} finally {
		globals.__aislopSpawn = originalSpawn;
		globals.__aislopPlugin = originalPlugin;
	}
};
export const runHookDoctor = async (
	options: {
		global?: boolean;
		project?: boolean;
		home?: string;
		cwd?: string;
		timeoutMs?: number;
	} = {},
): Promise<HookDoctorReport> => {
	const scopes: Scope[] =
		options.global || options.project
			? [
					...(options.global ? ["global" as const] : []),
					...(options.project ? ["project" as const] : []),
				]
			: ["global", "project"];
	const home = options.home ?? os.homedir();
	const root = resolveHookRoot(options.cwd ?? process.cwd());
	const entries: HookDoctorEntry[] = [];
	for (const host of ALL_AGENTS)
		for (const scope of scopesFor(host, scopes)) {
			const files = REGISTRY[host].paths({
				home,
				cwd: root,
				scope,
				absolute: scope === "global",
				qualityGate: false,
			});
			if (host === "pi" || host === "opencode") {
				for (const file of files)
					if (fs.existsSync(file) && fs.readFileSync(file, "utf8").includes("aislop"))
						entries.push(await runPlugin(host, file, scope, home, root));
				continue;
			}
			for (const file of files)
				for (const entry of entriesInFile(file)) {
					const result = await runHookDoctorEntry(
						entry,
						options.timeoutMs,
						spawnProcess,
						true,
						root,
					);
					entries.push({
						host,
						scope,
						eventGroup: entry.eventGroup,
						commandForm: entry.exec ? "absolute" : "portable",
						...result,
						stop:
							entry.args?.some((arg) => arg.includes("--stop")) ||
							entry.command?.includes("--stop") ||
							false,
					});
				}
		}
	const baseline = scopes.map((scope): HookDoctorBaseline => {
		const hasStop = entries.some((entry) => entry.scope === scope && entry.stop === true);
		if (!hasStop) return { scope, status: "not-required" };
		const existing = readBaseline(root);
		return existing ? { scope, status: "ok", score: existing.score } : { scope, status: "missing" };
	});
	return {
		entries,
		runtime: scopes.map((scope) => hookDoctorRuntime(scope, home, root)),
		baseline,
	};
};
