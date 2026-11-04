import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWrite, readIfExists } from "../io/atomic-write.js";
import { type HookRuntime, resolveHookRuntime } from "./resolve.js";

const RUNTIME_FILE = "hook-runtime.json";

interface StoredHookRuntime extends HookRuntime {
	schema: 1;
	writtenAt: string;
}

export type HookRuntimeReadResult =
	| { status: "ok"; runtime: StoredHookRuntime; path: string }
	| { status: "missing" | "invalid" | "stale"; path: string };

const runtimePath = (dir: string): string => path.join(dir, ".aislop", RUNTIME_FILE);

const isStoredRuntime = (value: unknown): value is StoredHookRuntime => {
	if (!value || typeof value !== "object") return false;
	const runtime = value as Partial<StoredHookRuntime>;
	return (
		runtime.schema === 1 &&
		typeof runtime.nodePath === "string" &&
		typeof runtime.cliPath === "string" &&
		typeof runtime.version === "string" &&
		typeof runtime.writtenAt === "string"
	);
};

export const writeHookRuntime = (
	scope: "global" | "project",
	locations: { home?: string; cwd?: string } = {},
): string => {
	const dir =
		scope === "global" ? (locations.home ?? os.homedir()) : (locations.cwd ?? process.cwd());
	const target = runtimePath(dir);
	const runtime: StoredHookRuntime = {
		schema: 1,
		...resolveHookRuntime(),
		writtenAt: new Date().toISOString(),
	};
	atomicWrite(target, `${JSON.stringify(runtime, null, 2)}\n`);
	return target;
};

export const readHookRuntime = (dir: string): HookRuntimeReadResult => {
	const target = runtimePath(dir);
	const raw = readIfExists(target);
	if (raw == null) return { status: "missing", path: target };
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isStoredRuntime(parsed)) return { status: "invalid", path: target };
		if (!fs.existsSync(parsed.nodePath) || !fs.existsSync(parsed.cliPath)) {
			return { status: "stale", path: target };
		}
		return { status: "ok", runtime: parsed, path: target };
	} catch {
		return { status: "invalid", path: target };
	}
};

export type HookRuntimeSource = "project" | "global" | "none";

export const readPreferredHookRuntime = (
	projectDir: string,
	home = os.homedir(),
): HookRuntimeReadResult & { source: HookRuntimeSource } => {
	const project = readHookRuntime(projectDir);
	if (project.status !== "missing") return { ...project, source: "project" };
	const global = readHookRuntime(home);
	return { ...global, source: global.status === "missing" ? "none" : "global" };
};
