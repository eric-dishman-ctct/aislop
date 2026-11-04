import path from "node:path";
import { readIfExists } from "../io/atomic-write.js";
import {
	applyContent,
	applyRemoval,
	emptyResult,
	type HookInstallOpts,
	type HookInstallResult,
	type HookUninstallResult,
} from "./types.js";

interface OpenCodePaths {
	plugin: string;
}

const MANAGED_MARKER = "aislop:generated-opencode";

export const resolveOpenCodePaths = (opts: HookInstallOpts): OpenCodePaths => ({
	plugin:
		opts.scope === "project"
			? path.join(opts.cwd, ".opencode", "plugins", "aislop.ts")
			: path.join(opts.home, ".config", "opencode", "plugins", "aislop.ts"),
});

// OpenCode loads this file directly as a v2 runtime plugin.
export const OPENCODE_PLUGIN_SOURCE = `// ${MANAGED_MARKER}. Do not edit by hand.
// Reinstall with: aislop hook install --opencode
import { Plugin } from "@opencode/plugin";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { join, resolve } from "${"node:" + "path"}";

const pending = new Map();
const ttlMs = 600000;
const spawnProcess = globalThis.__aislopSpawn || spawn;
const staleRuntimeMessage = "aislop: hook runtime stale, run aislop hook install";

const readRuntime = (dir) => {
	try {
		const runtimePath = join(dir, ".aislop", "hook-runtime.json");
		if (!fs.existsSync(runtimePath)) return { status: "missing" };
		const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf-8"));
		if (
			runtime?.schema !== 1 ||
			typeof runtime.nodePath !== "string" ||
			typeof runtime.cliPath !== "string"
		) return { status: "invalid" };
		if (!fs.existsSync(runtime.nodePath) || !fs.existsSync(runtime.cliPath)) return { status: "stale" };
		return { status: "ok", runtime };
	} catch {
		return { status: "invalid" };
	}
};

const readPreferredRuntime = (projectDir) => {
	try {
		const project = readRuntime(projectDir);
		return project.status === "missing" ? readRuntime(os.homedir()) : project;
	} catch {
		return { status: "invalid" };
	}
};

const runHook = (bin, args, input, cwd) =>
	new Promise((resolveResult) => {
		let child;
		try {
			child = spawnProcess(bin, args, { cwd, stdio: ["pipe", "pipe", "ignore"] });
		} catch {
			resolveResult(null);
			return;
		}
		const chunks = [];
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolveResult(value);
		};
		const timer = setTimeout(() => {
			try { child.kill(); } catch {}
			finish(null);
		}, 8000);
		child.stdout.on("data", (chunk) => chunks.push(chunk));
		child.on("error", () => finish(null));
		child.on("close", (code) =>
			finish(code === 0 && chunks.length > 0 ? Buffer.concat(chunks).toString("utf-8") : null),
		);
		child.stdin.on("error", () => {});
		try {
			child.stdin.end(input);
		} catch {
			finish(null);
		}
	});

export default Plugin.define({
	id: "aislop",
	async setup(ctx) {
		await ctx.tool.hook("execute.after", async (event) => {
			try {
				if (event.status !== "completed" || !["edit", "write", "patch"].includes(event.tool)) return;
				const applied = event.result?.output?.applied;
				const targets = Array.isArray(applied)
					? applied.map((item) => item?.target).filter((target) => typeof target === "string")
					: [];
				const inputPath = event.input?.path;
				const rawPaths = targets.length > 0 ? targets : typeof inputPath === "string" ? [inputPath] : [];
				if (rawPaths.length === 0) return;
				const filePaths = rawPaths.map((filePath) => resolve(ctx.location.directory, filePath));
				const override = process.env.AISLOP_BIN;
				const runtime = override ? { status: "missing" } : readPreferredRuntime(ctx.location.directory);
				const feedback = runtime.status === "stale" ? [staleRuntimeMessage] : [];
				const [bin, args] = override
					? [override, ["hook", "opencode"]]
					: runtime.status === "ok"
						? [runtime.runtime.nodePath, [runtime.runtime.cliPath, "hook", "opencode"]]
						: ["aislop", ["hook", "opencode"]];
				const stdout = await runHook(
					bin,
					args,
					JSON.stringify({ cwd: ctx.location.directory, file_paths: filePaths, tool_name: event.tool }),
					ctx.location.directory,
				);
				if (stdout) {
					try {
						const out = JSON.parse(stdout);
						if (typeof out?.message === "string" && out.message.trim().length > 0) feedback.push(out.message);
					} catch {}
				}
				if (feedback.length === 0) return;
				const current = pending.get(event.sessionID);
				const texts = current && Date.now() - current.at < ttlMs ? current.texts : [];
				texts.push("AISLOP FEEDBACK:\\n" + feedback.join("\\n"));
				pending.set(event.sessionID, { texts, at: Date.now() });
			} catch {}
		});
		await ctx.session.hook("context", async (event) => {
			try {
				const now = Date.now();
				for (const [sessionID, entry] of pending) {
					if (now - entry.at >= ttlMs) pending.delete(sessionID);
				}
				const entry = pending.get(event.sessionID);
				if (!entry) return;
				for (const text of entry.texts) {
					event.messages.push({ role: "user", content: [{ type: "text", text }] });
				}
				pending.delete(event.sessionID);
			} catch {}
		});
	},
});
`;

export const installOpenCode = (opts: HookInstallOpts): HookInstallResult => {
	const paths = resolveOpenCodePaths(opts);
	const result = emptyResult();
	applyContent(result, opts, paths.plugin, OPENCODE_PLUGIN_SOURCE, "write OpenCode aislop plugin");
	return result;
};

export const uninstallOpenCode = (
	opts: Omit<HookInstallOpts, "qualityGate">,
): HookUninstallResult => {
	const paths = resolveOpenCodePaths({ ...opts, qualityGate: false });
	const result: HookUninstallResult = { removed: [], skipped: [] };
	const content = readIfExists(paths.plugin);
	if (content?.includes(MANAGED_MARKER)) applyRemoval(result, opts, paths.plugin, null);
	else result.skipped.push(paths.plugin);
	return result;
};
