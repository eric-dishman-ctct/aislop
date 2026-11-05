import {
	type DisplayRow,
	renderDisplayRows,
	renderDisplaySection,
	renderDisplayStatusItems,
} from "../../ui/display.js";
import { renderHeader } from "../../ui/header.js";
import { APP_VERSION } from "../../version.js";
import { hookMarker } from "../status-render.js";
import type { HookBaselineResult } from "./baseline-step.js";
import type { AgentName } from "./registry.js";
import type { HookInstallResult } from "./types.js";

export interface HookInstallRenderItem {
	agent: AgentName;
	scope: "global" | "project";
	result: HookInstallResult;
	absolute?: boolean;
}

const installStatus = (item: HookInstallRenderItem, dryRun: boolean): string => {
	if (dryRun) return item.result.planned.length > 0 ? "planned" : "up to date";
	return item.result.wrote.length > 0 ? "updated" : "up to date";
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
		for (const op of item.result.planned)
			rows.push({ label: "Path", value: op.path }, { label: "Change", value: op.summary });
		return rows;
	}
	if (item.result.rewrittenFromPortable)
		rows.push({ label: "Rewrote portable command", value: "absolute Node and CLI paths" });
	if (item.result.rewrittenFromStaleAbsolute)
		rows.push({ label: "Rewrote stale absolute command", value: "current Node and CLI paths" });
	for (const target of item.result.wrote) rows.push({ label: "Wrote", value: target });
	for (const target of item.result.skipped) rows.push({ label: "Skipped", value: target });
	return rows;
};

export const renderHookInstall = (input: {
	dryRun: boolean;
	items: HookInstallRenderItem[];
	baseline?: HookBaselineResult;
}): string => {
	const lines = [
		renderHeader({
			version: APP_VERSION,
			command: "Hook install",
			context: input.dryRun ? ["dry-run"] : [],
		}).trimEnd(),
		"",
		renderDisplaySection("Agents"),
		...renderDisplayStatusItems(
			input.items.map((item) => ({
				marker: hookMarker(installStatus(item, input.dryRun) !== "up to date"),
				label: item.agent,
				rows: [
					{ label: "Status", value: installStatus(item, input.dryRun) },
					...installRows(item, input.dryRun),
				],
			})),
		),
	];
	if (input.baseline) {
		const score = input.baseline.score === undefined ? "" : `, score ${input.baseline.score}`;
		lines.push(
			"",
			...renderDisplayRows([
				{ label: "Baseline", value: `${input.baseline.action}${score}, ${input.baseline.path}` },
			]),
		);
	}
	if (input.dryRun)
		lines.push(
			"",
			renderDisplaySection("Next"),
			...renderDisplayRows([{ label: "Apply", value: "rerun without --dry-run" }]),
		);
	return `${lines.join("\n")}\n`;
};
