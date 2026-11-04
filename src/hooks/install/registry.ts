import fs from "node:fs";
import {
	installAntigravity,
	resolveAntigravityPaths,
	uninstallAntigravity,
} from "./antigravity.js";
import { installClaude, resolveClaudePaths, uninstallClaude } from "./claude.js";
import { installCline, resolveClinePaths, resolveRooPaths, uninstallCline } from "./cline.js";
import { installCodex, resolveCodexPaths, uninstallCodex } from "./codex.js";
import { installCopilot, resolveCopilotPaths, uninstallCopilot } from "./copilot.js";
import { installCursor, resolveCursorPaths, uninstallCursor } from "./cursor.js";
import { installGemini, resolveGeminiPaths, uninstallGemini } from "./gemini.js";
import { installKilocode, resolveKilocodePaths, uninstallKilocode } from "./kilocode.js";
import { installPi, resolvePiPaths, uninstallPi } from "./pi.js";
import { installOpenCode, resolveOpenCodePaths, uninstallOpenCode } from "./opencode.js";
import type { HookInstallOpts, HookInstallResult, HookUninstallResult } from "./types.js";
import { installWindsurf, resolveWindsurfPaths, uninstallWindsurf } from "./windsurf.js";

export type AgentName =
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
	| "opencode";

export const ALL_AGENTS: AgentName[] = [
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
];

export const AGENTS_PROJECT_ONLY: AgentName[] = ["windsurf", "cline", "kilocode", "antigravity"];
export const AGENTS_SUPPORTING_BOTH_SCOPES: AgentName[] = [
	"claude",
	"cursor",
	"gemini",
	"pi",
	"codex",
	"copilot",
	"opencode",
];

interface AgentEntry {
	install: (opts: HookInstallOpts) => HookInstallResult;
	uninstall: (opts: Omit<HookInstallOpts, "qualityGate">) => HookUninstallResult;
	paths: (opts: HookInstallOpts) => string[];
}

const paths = {
	claude: (opts: HookInstallOpts): string[] => {
		const p = resolveClaudePaths(opts);
		return [p.settings, p.aislopMd, p.claudeMd];
	},
	cursor: (opts: HookInstallOpts): string[] => {
		const p = resolveCursorPaths(opts);
		return opts.scope === "project" ? [p.hooks, p.rules] : [p.hooks];
	},
	gemini: (opts: HookInstallOpts): string[] => {
		const p = resolveGeminiPaths(opts);
		return [p.settings, p.aislopMd, p.geminiMd];
	},
	pi: (opts: HookInstallOpts): string[] => [resolvePiPaths(opts).extension],
	codex: (opts: HookInstallOpts): string[] => [resolveCodexPaths(opts).rules],
	windsurf: (opts: HookInstallOpts): string[] => [resolveWindsurfPaths(opts).rules],
	cline: (opts: HookInstallOpts): string[] => [
		resolveClinePaths(opts).rules,
		resolveRooPaths(opts).rules,
	],
	kilocode: (opts: HookInstallOpts): string[] => [resolveKilocodePaths(opts).rules],
	antigravity: (opts: HookInstallOpts): string[] => [resolveAntigravityPaths(opts).rules],
	copilot: (opts: HookInstallOpts): string[] => {
		const p = resolveCopilotPaths(opts);
		return opts.scope === "project" ? [p.hookFile, p.instructionsFile] : [p.hookFile];
	},
	opencode: (opts: HookInstallOpts): string[] => [resolveOpenCodePaths(opts).plugin],
};

export const REGISTRY: Record<AgentName, AgentEntry> = {
	claude: { install: installClaude, uninstall: uninstallClaude, paths: paths.claude },
	cursor: { install: installCursor, uninstall: uninstallCursor, paths: paths.cursor },
	gemini: { install: installGemini, uninstall: uninstallGemini, paths: paths.gemini },
	pi: { install: installPi, uninstall: uninstallPi, paths: paths.pi },
	codex: { install: installCodex, uninstall: uninstallCodex, paths: paths.codex },
	windsurf: { install: installWindsurf, uninstall: uninstallWindsurf, paths: paths.windsurf },
	cline: { install: installCline, uninstall: uninstallCline, paths: paths.cline },
	kilocode: { install: installKilocode, uninstall: uninstallKilocode, paths: paths.kilocode },
	antigravity: {
		install: installAntigravity,
		uninstall: uninstallAntigravity,
		paths: paths.antigravity,
	},
	copilot: { install: installCopilot, uninstall: uninstallCopilot, paths: paths.copilot },
	opencode: { install: installOpenCode, uninstall: uninstallOpenCode, paths: paths.opencode },
};

export const defaultScopeFor = (agent: AgentName): "global" | "project" =>
	AGENTS_PROJECT_ONLY.includes(agent) ? "project" : "global";

export const detectInstalledAgents = (opts: { home: string; cwd: string }): AgentName[] => {
	const hits: AgentName[] = [];
	for (const agent of ALL_AGENTS) {
		if (
			detectionScopes(agent).some((scope) =>
				REGISTRY[agent]
					.paths({ home: opts.home, cwd: opts.cwd, scope, absolute: scope === "global" })
					.some((target) => fs.existsSync(target)),
			)
		) {
			hits.push(agent);
		}
	}
	return hits;
};

const AISLOP_MARKERS = ["__aislop", "aislop:begin", "@AISLOP.md"];

const hasAislopHook = (target: string): boolean => {
	try {
		if (!fs.statSync(target).isFile()) return false;
		const content = fs.readFileSync(target, "utf8");
		return AISLOP_MARKERS.some((marker) => content.includes(marker));
	} catch {
		return false;
	}
};

const detectionScopes = (agent: AgentName): Array<"global" | "project"> =>
	AGENTS_SUPPORTING_BOTH_SCOPES.includes(agent) ? ["global", "project"] : [defaultScopeFor(agent)];

export const scopeHasManagedMarker = (
	agent: AgentName,
	opts: { home: string; cwd: string; scope: "global" | "project" },
): boolean =>
	REGISTRY[agent].paths({ ...opts, absolute: opts.scope === "global" }).some(hasAislopHook);

export const detectAislopHooks = (opts: { home: string; cwd: string }): AgentName[] =>
	ALL_AGENTS.filter((agent) =>
		detectionScopes(agent).some((scope) =>
			REGISTRY[agent]
				.paths({ home: opts.home, cwd: opts.cwd, scope, absolute: scope === "global" })
				.some(hasAislopHook),
		),
	);
