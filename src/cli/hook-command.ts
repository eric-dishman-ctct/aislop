import os from "node:os";
import type { Command } from "commander";
import {
	defaultInstallTargets,
	hasExplicitAgentSelection,
	hookBaseline,
	hookInstall,
	hookRun,
	hookStatus,
	hookUninstall,
	promptAgentSelection,
	resolveAgents,
} from "../commands/hook.js";
import { loadConfig } from "../config/index.js";
import { renderHookDoctor, runHookDoctor } from "../hooks/doctor.js";
import { type AgentName, detectInstalledAgents } from "../hooks/install/registry.js";
import { resolveHookRoot } from "../hooks/io/project-root.js";
import { allowHookRuntimeInstall } from "../hooks/runtime/install.js";
import { printHookRuntime } from "../hooks/runtime/status.js";
import { withCommandLifecycle } from "../telemetry/index.js";
import { log } from "../ui/logger.js";

export const HOOK_COMMAND_NAMES = ["hook", "hooks"] as const;

type AgentFlagOpts = Partial<
	Record<
		| "claude"
		| "cursor"
		| "gemini"
		| "pi"
		| "codex"
		| "windsurf"
		| "cline"
		| "kilocode"
		| "antigravity"
		| "copilot"
		| "opencode",
		boolean
	>
>;

const AGENT_NAMES = [
	"claude",
	"cursor",
	"gemini",
	"pi",
	"codex",
	"windsurf",
	"cline",
	"kilocode",
	"antigravity",
	"copilot",
	"opencode",
] as const;

const resolveScope = (flags: { global?: boolean; project?: boolean }): "global" | "project" => {
	if (flags.project) return "project";
	if (flags.global) return "global";
	return "global";
};

const promptForUninstall = async (): Promise<AgentName[] | null> => {
	const installed = detectInstalledAgents({
		home: os.homedir(),
		cwd: resolveHookRoot(process.cwd()),
	});
	if (installed.length === 0) {
		log.warn("No aislop hooks installed. Nothing to uninstall.");
		return [];
	}
	const picked = await promptAgentSelection("uninstall", { installed });
	if (picked === null) {
		log.warn("Cancelled.");
		return null;
	}
	if (picked.length === 0) {
		log.warn("No agents selected. Nothing to uninstall.");
		return [];
	}
	return picked;
};

const promptForInstall = async (): Promise<AgentName[] | null> => {
	const picked = await promptAgentSelection("install");
	if (picked === null) {
		log.warn("Cancelled.");
		return null;
	}
	if (picked.length === 0) {
		log.warn("No agents selected. Nothing to install.");
		return [];
	}
	return picked;
};

const pickAgents = async (
	mode: "install" | "uninstall",
	opts: AgentFlagOpts & { agent?: string },
	positional: string[],
): Promise<AgentName[] | null> => {
	if (hasExplicitAgentSelection(opts, positional, opts.agent)) {
		return resolveAgents(opts, positional, opts.agent, defaultInstallTargets());
	}
	if (!process.stdin.isTTY) return defaultInstallTargets();
	return mode === "uninstall" ? promptForUninstall() : promptForInstall();
};

type InstallOpts = AgentFlagOpts & {
	agent?: string;
	global?: boolean;
	project?: boolean;
	dryRun?: boolean;
	yes?: boolean;
	qualityGate?: boolean;
	absolute?: boolean;
	forceTemporary?: boolean;
};

type UninstallOpts = AgentFlagOpts & {
	agent?: string;
	global?: boolean;
	project?: boolean;
	dryRun?: boolean;
	yes?: boolean;
};

const addAgentShortcutOptions = (command: Command): Command => {
	for (const a of AGENT_NAMES) command.option(`--${a}`, `shortcut for --agent ${a}`);
	return command;
};

const addInstallOptions = (command: Command): Command =>
	addAgentShortcutOptions(
		command
			.option(
				"--agent <names>",
				"comma-separated agent list (claude,cursor,gemini,pi,codex,windsurf,cline,kilocode,antigravity,copilot,opencode)",
			)
			.option("-g, --global", "install to the user-scope config (default)")
			.option("--project", "install to the project-scope config")
			.option("--absolute", "write absolute Node and CLI paths for a project install")
			.option("--dry-run", "print the planned diff without writing")
			.option("--yes", "skip the confirmation prompt (reserved)")
			.option("--force-temporary", "allow an install from a temporary package cache")
			.option(
				"--quality-gate",
				"add a Stop hook that blocks when the score regresses below the baseline (Claude and Copilot). The gate rescans files recorded from Edit, Write, and MultiEdit calls. It does not see shell edits to unrecorded files. Records persist across sessions until a Stop with no regression clears them. Not available for OpenCode.",
			),
	);

const addUninstallOptions = (command: Command): Command =>
	addAgentShortcutOptions(
		command
			.option("--agent <names>", "comma-separated agent list")
			.option("-g, --global", "uninstall from user-scope config")
			.option("--project", "uninstall from project-scope config")
			.option("--dry-run", "print the planned removal without writing")
			.option("--yes", "skip the confirmation prompt (reserved)"),
	);

const runInstallAction = async (positional: string[], opts: InstallOpts): Promise<void> => {
	const agents = await pickAgents("install", opts, positional);
	if (agents === null || agents.length === 0) return;
	if (!allowHookRuntimeInstall(Boolean(opts.dryRun), Boolean(opts.forceTemporary))) return;
	await withCommandLifecycle(
		{ command: "hook_install", config: loadConfig(process.cwd()).telemetry },
		async () => {
			await hookInstall({
				agents,
				scope: resolveScope(opts),
				dryRun: Boolean(opts.dryRun),
				yes: Boolean(opts.yes),
				qualityGate: Boolean(opts.qualityGate),
				absolute: Boolean(opts.absolute),
				forceTemporary: Boolean(opts.forceTemporary),
				explicitScope: Boolean(opts.global || opts.project),
			});
			return { exitCode: 0 };
		},
	);
};

const runUninstallAction = async (positional: string[], opts: UninstallOpts): Promise<void> => {
	const agents = await pickAgents("uninstall", opts, positional);
	if (agents === null || agents.length === 0) return;
	await withCommandLifecycle(
		{ command: "hook_uninstall", config: loadConfig(process.cwd()).telemetry },
		async () => {
			await hookUninstall({
				agents,
				scope: resolveScope(opts),
				dryRun: Boolean(opts.dryRun),
				yes: true,
				qualityGate: false,
				explicitScope: Boolean(opts.global || opts.project),
			});
			return { exitCode: 0 };
		},
	);
};

const normalizeHookAliasAgents = (agents: string[]): string[] => {
	const [first, ...rest] = agents;
	return first === "hook" || first === "hooks" ? rest : agents;
};

const registerInstall = (hook: Command): void => {
	addInstallOptions(
		hook
			.command("install [agents...]")
			.description(
				"Install hooks for one or more coding agents. Use positional agents, per-agent flags, or --agent.",
			),
	).action(runInstallAction);
};

const registerUninstall = (hook: Command): void => {
	addUninstallOptions(
		hook
			.command("uninstall [agents...]")
			.description(
				"Remove hooks for one or more coding agents. Use positional agents, per-agent flags, or --agent.",
			),
	).action(runUninstallAction);
};

const registerRuntime = (hook: Command): void => {
	hook
		.command("runtime")
		.description("Show the resolved hook runtime paths")
		.option("--json", "print JSON")
		.action(() =>
			printHookRuntime(process.argv.includes("--json"), resolveHookRoot(process.cwd())),
		);
};

const registerDoctor = (hook: Command): void => {
	hook
		.command("doctor")
		.description("Check installed managed hook commands")
		.option("--json", "print JSON")
		.option("--global", "check the user-scope config")
		.option("--project", "check the project-scope config")
		.action(async (opts: { json?: boolean; global?: boolean; project?: boolean }, command) => {
			const report = await runHookDoctor(opts);
			const globals = command.optsWithGlobals() as { json?: boolean };
			process.stdout.write(renderHookDoctor(report, Boolean(opts.json || globals.json)));
			if (report.entries.length === 0) process.exitCode = 2;
			else if (
				report.entries.some((entry) => !entry.delivered || entry.provenanceMismatch) ||
				report.runtime.some((item) => item.status === "stale") ||
				report.baseline.some((item) => item.status === "missing")
			)
				process.exitCode = 1;
		});
};

const registerRuntimeCallback = (
	hook: Command,
	agent: "cursor" | "gemini" | "pi" | "opencode",
	description: string,
): void => {
	hook
		.command(agent, { hidden: true })
		.description(description)
		.option("--doctor-probe", "print the inert hook probe envelope")
		.action(async (opts: { doctorProbe?: boolean }) => {
			await hookRun(agent, opts);
		});
};

const registerCallbacks = (hook: Command): void => {
	hook
		.command("status")
		.description("Show installed agent hooks")
		.action(async () => {
			await withCommandLifecycle(
				{ command: "hook_status", config: loadConfig(process.cwd()).telemetry },
				async () => {
					await hookStatus();
					return { exitCode: 0 };
				},
			);
		});
	hook
		.command("baseline")
		.description("Capture the current score as the hook baseline")
		.action(async () => {
			await withCommandLifecycle(
				{ command: "hook_baseline", config: loadConfig(process.cwd()).telemetry },
				async () => {
					await hookBaseline();
					return { exitCode: 0 };
				},
			);
		});
	hook
		.command("claude", { hidden: true })
		.description("Internal: Claude Code PostToolUse / Stop / FileChanged callback (reads stdin)")
		.option("--stop", "run in Stop-hook mode for the quality gate")
		.option(
			"--on-file-changed",
			"run in FileChanged mode (refresh baseline on watched file change)",
		)
		.option("--doctor-probe", "print the inert hook probe envelope")
		.action(async (opts: { stop?: boolean; onFileChanged?: boolean; doctorProbe?: boolean }) => {
			await hookRun("claude", {
				stop: Boolean(opts.stop),
				onFileChanged: Boolean(opts.onFileChanged),
				doctorProbe: Boolean(opts.doctorProbe),
			});
		});
	registerRuntimeCallback(hook, "cursor", "Internal: Cursor afterFileEdit callback (reads stdin)");
	registerRuntimeCallback(hook, "gemini", "Internal: Gemini CLI AfterTool callback (reads stdin)");
	registerRuntimeCallback(hook, "pi", "Internal: pi extension tool_result callback (reads stdin)");
	registerRuntimeCallback(hook, "opencode", "Internal: OpenCode runtime callback (reads stdin)");
};

export const registerHookCommand = (program: Command): void => {
	const hook = program
		.command(HOOK_COMMAND_NAMES[0])
		.alias(HOOK_COMMAND_NAMES[1])
		.description("Manage per-edit coding-agent hooks");
	registerInstall(hook);
	registerUninstall(hook);
	registerRuntime(hook);
	registerDoctor(hook);
	registerCallbacks(hook);
};

export const registerHookAliases = (program: Command): void => {
	addInstallOptions(
		program
			.command("install [agents...]")
			.description("Install coding-agent hooks (alias: hook install)"),
	).action(async (agents: string[], opts: InstallOpts) => {
		await runInstallAction(normalizeHookAliasAgents(agents), opts);
	});

	addUninstallOptions(
		program
			.command("uninstall [agents...]")
			.description("Remove coding-agent hooks (alias: hook uninstall)"),
	).action(async (agents: string[], opts: UninstallOpts) => {
		await runUninstallAction(normalizeHookAliasAgents(agents), opts);
	});
};
