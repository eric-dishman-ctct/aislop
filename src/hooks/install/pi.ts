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

interface PiPaths {
	extension: string;
}

export const resolvePiPaths = (opts: HookInstallOpts): PiPaths => {
	const extension =
		opts.scope === "project"
			? path.join(opts.cwd, ".pi", "extensions", "aislop.js")
			: path.join(opts.home, ".pi", "agent", "extensions", "aislop.js");
	return { extension };
};

// pi has no declarative command-hook, so the integration ships as an ESM extension.
export const PI_EXTENSION_SOURCE = `// aislop — auto-generated pi extension. Do not edit by hand.
// Reinstall with: aislop hook install --pi
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "${"node:" + "path"}";

const spawnProcess = globalThis.__aislopSpawn || spawn;
const staleRuntimeMessage = "aislop: hook runtime stale, run aislop hook install";

const readRuntime = (dir) => {
	try {
		const runtimePath = path.join(dir, ".aislop", "hook-runtime.json");
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

// Runs the CLI async so a slow scan never blocks pi's event loop, and forwards
// ctx.signal so Esc actually kills the child instead of it running to completion.
const runHook = (bin, args, input, signal) =>
	new Promise((resolve) => {
		let child;
		try {
			child = spawnProcess(bin, args, { stdio: ["pipe", "pipe", "ignore"] });
		} catch {
			resolve(null);
			return;
		}
		const chunks = [];
		let settled = false;
		let timer;
		const onAbort = () => {
			child.kill();
			finish(null);
		};
		const cleanup = () => {
			if (timer !== undefined) clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};
		const finish = (value) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		timer = setTimeout(() => {
			child.kill();
			finish(null);
		}, 15000);
		child.stdout.on("data", (c) => chunks.push(c));
		child.on("error", () => finish(null));
		child.on("close", (code) => {
			finish(code === 0 && chunks.length > 0 ? Buffer.concat(chunks).toString("utf-8") : null);
		});
		child.stdin.end(input);
	});

export default function (pi) {
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "edit" && event.toolName !== "write") return;
		if (event.isError) return;
		const filePath = event.input && event.input.path;
		if (typeof filePath !== "string" || filePath.length === 0) return;

		const override = process.env.AISLOP_BIN;
		const runtime = override ? { status: "missing" } : readPreferredRuntime(ctx.cwd);
		const staleFeedback = runtime.status === "stale" ? [staleRuntimeMessage] : [];
		const [bin, args] = override
			? [override, ["hook", "pi"]]
			: runtime.status === "ok"
				? [runtime.runtime.nodePath, [runtime.runtime.cliPath, "hook", "pi"]]
				: ["aislop", ["hook", "pi"]];
		const payload = JSON.stringify({
			cwd: ctx.cwd,
			file_path: filePath,
			tool_name: event.toolName,
		});

		try {
			const stdout = await runHook(bin, args, payload, ctx.signal);
			if (stdout) {
				const out = JSON.parse(stdout);
				if (typeof out?.message === "string" && out.message.length > 0) staleFeedback.push(out.message);
			}
		} catch {}
		if (staleFeedback.length === 0) return;

		return {
			content: [...event.content, { type: "text", text: staleFeedback.join("\\n") }],
			isError: event.isError,
		};
	});
}
`;

export const installPi = (opts: HookInstallOpts): HookInstallResult => {
	const paths = resolvePiPaths(opts);
	const result = emptyResult();
	applyContent(result, opts, paths.extension, PI_EXTENSION_SOURCE, "write pi aislop extension");
	return result;
};

export const uninstallPi = (opts: Omit<HookInstallOpts, "qualityGate">): HookUninstallResult => {
	const paths = resolvePiPaths(opts);
	const result: HookUninstallResult = { removed: [], skipped: [] };
	if (readIfExists(paths.extension) != null) {
		applyRemoval(result, opts, paths.extension, null);
	} else {
		result.skipped.push(paths.extension);
	}
	return result;
};
