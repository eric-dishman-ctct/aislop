import fs from "node:fs";
import os from "node:os";
import {
	AGENTS_SUPPORTING_BOTH_SCOPES,
	ALL_AGENTS,
	defaultScopeFor,
	detectInstalledAgents,
	REGISTRY,
	scopeHasManagedMarker,
	type AgentName,
} from "./install/registry.js";
import { hookDoctorRuntime } from "./doctor.js";
import { resolveHookRoot } from "./io/project-root.js";
import { renderDisplaySection, renderDisplayStatusItems } from "../ui/display.js";
import { renderHeader } from "../ui/header.js";
import { style, theme } from "../ui/theme.js";
import { APP_VERSION } from "../version.js";

export const hookMarker = (active: boolean): string =>
	active ? style(theme, "success", "✓") : style(theme, "muted", "·");

export const hookStatus = async (cwd = process.cwd(), home = os.homedir()): Promise<void> => {
	const root = resolveHookRoot(cwd);
	const installed = new Set(detectInstalledAgents({ home, cwd: root }));
	const items = ALL_AGENTS.map((agent) => {
		const scopes = AGENTS_SUPPORTING_BOTH_SCOPES.includes(agent)
			? (["global", "project"] as const)
			: [defaultScopeFor(agent)];
		const targets = scopes.flatMap((scope) =>
			REGISTRY[agent].paths({ home, cwd: root, scope, absolute: scope === "global" }),
		);
		const runtimeStatus = scopes.filter(
			(scope) =>
				scopeHasManagedMarker(agent, { home, cwd: root, scope }) &&
				hookDoctorRuntime(scope, home, root).status === "stale",
		);
		return {
			agent,
			scope: scopes.join(" + "),
			installed: installed.has(agent),
			paths: targets.filter((p) => fs.existsSync(p)),
			stale: runtimeStatus.length > 0,
		};
	});
	process.stdout.write(renderHookStatus(items));
};

export const renderHookStatus = (
	items: Array<{
		agent: AgentName;
		scope: string;
		installed: boolean;
		paths: string[];
		stale?: boolean;
	}>,
): string => {
	const lines = [
		renderHeader({ version: APP_VERSION, command: "Hook status", context: [] }).trimEnd(),
		"",
		renderDisplaySection("Hooks"),
		...renderDisplayStatusItems(
			items.map((item) => ({
				marker: hookMarker(item.installed),
				label: item.agent,
				rows: [
					{
						label: "Status",
						value: item.stale ? "stale" : item.installed ? "installed" : "not installed",
					},
					{ label: "Scope", value: item.scope },
					...item.paths.map((p) => ({ label: "Path", value: p })),
				],
			})),
		),
	];
	return `${lines.join("\n")}\n`;
};
