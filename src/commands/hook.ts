import os from "node:os";
import {
	runClaudeFileChangedHook,
	runClaudeHook,
	runClaudeStopHook,
} from "../hooks/adapters/claude.js";
import { runCursorHook } from "../hooks/adapters/cursor.js";
import { runGeminiHook } from "../hooks/adapters/gemini.js";
import { runPiHook } from "../hooks/adapters/pi.js";
import { runOpenCodeHook } from "../hooks/adapters/opencode.js";
import {
	AGENTS_PROJECT_ONLY,
	AGENTS_SUPPORTING_BOTH_SCOPES,
	type AgentName,
	ALL_AGENTS,
	REGISTRY,
	scopeHasManagedMarker,
} from "../hooks/install/registry.js";
import type {
	HookInstallOpts,
	HookInstallResult,
	HookUninstallResult,
} from "../hooks/install/types.js";
import { resolveHookRoot } from "../hooks/io/project-root.js";
import { captureBaseline } from "../hooks/quality-gate/baseline.js";
import { flushTelemetry } from "../telemetry/client.js";
import { resolveHookRuntime } from "../hooks/runtime/resolve.js";
import { allowHookRuntimeInstall, writeInstalledHookRuntimes } from "../hooks/runtime/install.js";
import { hookMarker } from "../hooks/status-render.js";
export { hookStatus, renderHookStatus } from "../hooks/status-render.js";
import {
	type DisplayRow,
	type DisplayStatusItem,
	renderDisplayRows,
	renderDisplaySection,
	renderDisplayStatusItems,
} from "../ui/display.js";
import { renderHeader } from "../ui/header.js";
import { searchMultiselect } from "../ui/search-select.js";
import { APP_VERSION } from "../version.js";

// A per-edit hook must not stall the agent on telemetry. Give the queued event a
// brief window to send before the process exits, then give up.
const HOOK_FLUSH_TIMEOUT_MS = 1500;

export const AGENT_LABELS: Record<AgentName, { label: string; hint: string }> = {
	claude: { label: "Claude Code", hint: "PostToolUse, runtime" },
	cursor: { label: "Cursor", hint: "afterFileEdit, runtime" },
	gemini: { label: "Gemini CLI", hint: "AfterTool, runtime" },
	pi: { label: "pi", hint: "extension, runtime" },
	codex: { label: "Codex CLI", hint: "rules-only" },
	windsurf: { label: "Windsurf", hint: "rules-only, project" },
	cline: { label: "Cline + Roo", hint: "rules-only, project" },
	kilocode: { label: "Kilo Code", hint: "rules-only, project" },
	antigravity: { label: "Antigravity", hint: "rules-only, project" },
	copilot: { label: "GitHub Copilot", hint: "runtime hook, global or project" },
	opencode: { label: "OpenCode", hint: "runtime hook, global or project" },
};

interface InstallFlags {
	agents: AgentName[];
	scope: "global" | "project";
	dryRun: boolean;
	yes: boolean;
	qualityGate: boolean;
	absolute?: boolean;
	explicitScope?: boolean;
}

interface HookInstallRenderItem {
	agent: AgentName;
	scope: "global" | "project";
	result: HookInstallResult;
	absolute?: boolean;
}

interface HookUninstallRenderItem {
	agent: AgentName;
	scope: "global" | "project";
	result: HookUninstallResult;
}

interface HookOperationRenderItem {
	agent: AgentName;
	status: string;
	rows: DisplayRow[];
}

export const resolveHookInstallOpts = (agent: AgentName, flags: InstallFlags): HookInstallOpts => {
	const scope: "global" | "project" = AGENTS_PROJECT_ONLY.includes(agent) ? "project" : flags.scope;
	return {
		home: os.homedir(),
		cwd: process.cwd(),
		scope,
		absolute: Boolean(flags.absolute) || scope === "global",
		dryRun: flags.dryRun,
		qualityGate: flags.qualityGate,
	};
};

export const hookInstall = async (
	flags: InstallFlags & { forceTemporary?: boolean },
): Promise<void> => {
	if (flags.qualityGate && flags.agents.includes("opencode")) {
		process.stderr.write(
			"The --quality-gate option is not available for OpenCode. No files were written.\n",
		);
		process.exitCode = 1;
		return;
	}
	if (!allowHookRuntimeInstall(flags.dryRun, Boolean(flags.forceTemporary))) return;
	const items: HookInstallRenderItem[] = [];
	const runtimeScopes = new Set<"global" | "project">();
	for (const agent of flags.agents) {
		const opts = resolveHookInstallOpts(agent, flags);
		const result = REGISTRY[agent].install(opts);
		items.push({ agent, scope: opts.scope, result, absolute: Boolean(opts.absolute) });
		runtimeScopes.add(opts.scope);
	}
	if (!flags.dryRun) writeInstalledHookRuntimes(runtimeScopes);
	if (flags.scope === "project") {
		process.stdout.write("Reminder: .aislop/hook-runtime.json holds machine paths.\n");
		if (flags.absolute) {
			process.stderr.write("Reminder: do not commit hook files with absolute machine paths.\n");
		}
	}
	process.stdout.write(renderHookInstall({ dryRun: flags.dryRun, items }));
};

export const hookUninstall = async (flags: InstallFlags): Promise<void> => {
	const items: HookUninstallRenderItem[] = [];
	for (const agent of flags.agents) {
		const scopes =
			!flags.explicitScope && AGENTS_SUPPORTING_BOTH_SCOPES.includes(agent)
				? (["global", "project"] as const)
				: [resolveHookInstallOpts(agent, flags).scope];
		for (const scope of scopes) {
			const opts = { ...resolveHookInstallOpts(agent, flags), scope };
			if (
				!flags.explicitScope &&
				!scopeHasManagedMarker(agent, { home: opts.home, cwd: opts.cwd, scope })
			)
				continue;
			const result = REGISTRY[agent].uninstall(opts);
			items.push({ agent, scope, result });
		}
	}
	process.stdout.write(renderHookUninstall({ dryRun: flags.dryRun, items }));
};

const installStatus = (item: HookInstallRenderItem, dryRun: boolean): string => {
	if (dryRun) return item.result.planned.length > 0 ? "planned" : "up to date";
	return item.result.wrote.length > 0 ? "updated" : "up to date";
};

const hookOperationItem = (item: HookOperationRenderItem): DisplayStatusItem => ({
	marker: hookMarker(item.status !== "up to date" && item.status !== "nothing installed"),
	label: item.agent,
	rows: [{ label: "Status", value: item.status }, ...item.rows],
});

const renderHookOperation = (input: {
	command: string;
	dryRun: boolean;
	items: HookOperationRenderItem[];
}): string => {
	const lines = [
		renderHeader({
			version: APP_VERSION,
			command: input.command,
			context: input.dryRun ? ["dry-run"] : [],
		}).trimEnd(),
		"",
		renderDisplaySection("Agents"),
		...renderDisplayStatusItems(input.items.map(hookOperationItem)),
	];
	if (input.dryRun) {
		lines.push(
			"",
			renderDisplaySection("Next"),
			...renderDisplayRows([{ label: "Apply", value: "rerun without --dry-run" }]),
		);
	}
	return `${lines.join("\n")}\n`;
};

const installRows = (item: HookInstallRenderItem, dryRun: boolean): DisplayRow[] => {
	const rows: DisplayRow[] = [
		{ label: "Scope", value: item.scope },
		{
			label: "Command",
			value: item.absolute ? "absolute Node and CLI paths" : "portable aislop command",
		},
	];
	if (dryRun) {
		for (const op of item.result.planned) {
			rows.push({ label: "Path", value: op.path }, { label: "Change", value: op.summary });
		}
		return rows;
	}
	if (item.result.rewrittenFromPortable) {
		rows.push({ label: "Rewrote portable command", value: "absolute Node and CLI paths" });
	}
	if (item.result.rewrittenFromStaleAbsolute) {
		rows.push({ label: "Rewrote stale absolute command", value: "current Node and CLI paths" });
	}
	for (const path of item.result.wrote) rows.push({ label: "Wrote", value: path });
	for (const path of item.result.skipped) rows.push({ label: "Skipped", value: path });
	return rows;
};

export const renderHookInstall = (input: {
	dryRun: boolean;
	items: HookInstallRenderItem[];
}): string =>
	renderHookOperation({
		command: "Hook install",
		dryRun: input.dryRun,
		items: input.items.map((item) => ({
			agent: item.agent,
			status: installStatus(item, input.dryRun),
			rows: installRows(item, input.dryRun),
		})),
	});

const uninstallRows = (item: HookUninstallRenderItem, dryRun: boolean): DisplayRow[] => [
	{ label: "Scope", value: item.scope },
	...item.result.removed.map((path) => ({
		label: dryRun ? "Remove" : "Removed",
		value: path,
	})),
	...item.result.skipped.map((path) => ({ label: "Skipped", value: path })),
];

export const renderHookUninstall = (input: {
	dryRun: boolean;
	items: HookUninstallRenderItem[];
}): string =>
	renderHookOperation({
		command: "Hook uninstall",
		dryRun: input.dryRun,
		items: input.items.map((item) => {
			const changed = item.result.removed.length > 0;
			return {
				agent: item.agent,
				status: changed ? (input.dryRun ? "planned" : "removed") : "nothing installed",
				rows: uninstallRows(item, input.dryRun),
			};
		}),
	});

export const hookRun = async (
	agent: AgentName,
	flags?: { stop?: boolean; onFileChanged?: boolean; doctorProbe?: boolean },
): Promise<void> => {
	if (flags?.doctorProbe) {
		const runtime = resolveHookRuntime();
		process.stdout.write(
			`${JSON.stringify({ schema: "aislop.hook.probe.v1", agent, version: APP_VERSION, cliPath: runtime.cliPath, nodePath: runtime.nodePath })}\n`,
		);
		return;
	}
	if (process.stdin.isTTY) {
		process.stderr.write(
			`aislop hook ${agent} is an internal callback the agent invokes automatically. It reads a payload on stdin and has nothing to do interactively.\n\nYou probably want:\n  aislop hook install --${agent}     (install the hook for ${agent})\n  aislop hook status                   (see what's installed)\n  aislop hook uninstall --${agent}   (remove it)\n`,
		);
		process.exit(0);
	}
	let exitCode = 0;
	if (agent === "claude") {
		if (flags?.onFileChanged) {
			exitCode = await runClaudeFileChangedHook();
		} else if (flags?.stop) {
			exitCode = await runClaudeStopHook();
		} else {
			exitCode = await runClaudeHook();
		}
	} else if (agent === "cursor") {
		exitCode = await runCursorHook();
	} else if (agent === "gemini") {
		exitCode = await runGeminiHook();
	} else if (agent === "pi") {
		exitCode = await runPiHook();
	} else if (agent === "opencode") {
		exitCode = await runOpenCodeHook();
	} else {
		process.stderr.write(`hook: agent "${agent}" has no runtime adapter (rules-file-only)\n`);
		process.exit(0);
	}
	// The adapters emit hook_scan_completed via fire-and-forget track(); flush it
	// before process.exit kills the in-flight request.
	await flushTelemetry(HOOK_FLUSH_TIMEOUT_MS);
	process.exit(exitCode);
};

export const hookBaseline = async (): Promise<void> => {
	const cwd = resolveHookRoot(process.cwd());
	const result = await captureBaseline(cwd);
	process.stdout.write(
		renderHookBaseline({ score: result.score, fileCount: result.fileCount, path: result.path }),
	);
};

export const renderHookBaseline = (input: {
	score: number;
	fileCount: number;
	path: string;
}): string =>
	[
		renderHeader({ version: APP_VERSION, command: "Hook baseline", context: [] }).trimEnd(),
		"",
		renderDisplaySection("Baseline"),
		...renderDisplayRows([
			{ label: "Score", value: `${input.score}/100` },
			{ label: "Files", value: String(input.fileCount) },
			{ label: "Path", value: input.path },
		]),
		"",
	].join("\n");

export const parseAgentFlag = (raw: string | undefined, fallback: AgentName[]): AgentName[] => {
	if (!raw) return fallback;
	const parts = raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const unknown = parts.filter((p): p is AgentName => !ALL_AGENTS.includes(p as AgentName));
	if (unknown.length > 0) {
		throw new Error(`Unknown agent(s): ${unknown.join(", ")}. Valid: ${ALL_AGENTS.join(", ")}`);
	}
	return parts as AgentName[];
};

export const defaultInstallTargets = (): AgentName[] => {
	return AGENTS_SUPPORTING_BOTH_SCOPES;
};

export const resolveAgents = (
	perAgentFlags: Partial<Record<AgentName, boolean>>,
	positional: string[],
	agentFlag: string | undefined,
	fallback: AgentName[],
): AgentName[] => {
	const flagged = ALL_AGENTS.filter((a) => perAgentFlags[a] === true);
	if (flagged.length > 0) return flagged;
	if (positional.length > 0) {
		const unknown = positional.filter((p): p is AgentName => !ALL_AGENTS.includes(p as AgentName));
		if (unknown.length > 0) {
			throw new Error(`Unknown agent(s): ${unknown.join(", ")}. Valid: ${ALL_AGENTS.join(", ")}`);
		}
		return positional as AgentName[];
	}
	return parseAgentFlag(agentFlag, fallback);
};

export const hasExplicitAgentSelection = (
	perAgentFlags: Partial<Record<AgentName, boolean>>,
	positional: string[],
	agentFlag: string | undefined,
): boolean => {
	if (ALL_AGENTS.some((a) => perAgentFlags[a] === true)) return true;
	if (positional.length > 0) return true;
	if (typeof agentFlag === "string" && agentFlag.trim().length > 0) return true;
	return false;
};

export const promptAgentSelection = async (
	mode: "install" | "uninstall",
	deps: { installed?: AgentName[] } = {},
): Promise<AgentName[] | null> => {
	const installed = deps.installed ?? [];
	const pool = mode === "uninstall" ? installed : ALL_AGENTS;
	if (pool.length === 0) return [];
	const preChecked =
		mode === "uninstall" ? installed : (AGENTS_SUPPORTING_BOTH_SCOPES as AgentName[]);
	const choice = await searchMultiselect<AgentName>({
		message:
			mode === "install"
				? "Which agents should get aislop hooks?"
				: "Which agent hooks should be removed?",
		items: pool.map((a) => ({
			value: a,
			label: AGENT_LABELS[a].label,
			hint: AGENT_LABELS[a].hint,
			keywords: [a],
		})),
		initialSelected: preChecked.filter((a) => pool.includes(a)),
		required: false,
	});
	return choice;
};
