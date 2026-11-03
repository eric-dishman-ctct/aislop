import path from "node:path";
import { AISLOP_MD_BODY } from "../assets.js";
import { readIfExists } from "../io/atomic-write.js";
import { removeAislopEntries, upsertHookGroup } from "../io/json-patch.js";
import { removeMarkdownFence, sentinelHash, upsertMarkdownFence } from "../io/sentinel.js";
import { buildHookGroup, buildStopHookGroup } from "./claude.js";
import {
	applyContent,
	applyRemoval,
	emptyResult,
	type HookInstallOpts,
	type HookInstallResult,
	type HookUninstallResult,
} from "./types.js";

interface CopilotPaths {
	hookFile: string;
	instructionsFile: string;
}

const COPILOT_INSTRUCTIONS = `${AISLOP_MD_BODY.trimEnd()}

## Copilot hook limits

Copilot hooks run only in a trusted folder. Use \`--trust-folder\` or add the folder to \`trustedFolders\` in \`~/.copilot/config.json\`.
Run \`aislop hook baseline\` once before you rely on \`--quality-gate\`.
The gate rescans files recorded from Edit, Write, and MultiEdit calls. It does not see shell edits to unrecorded files.
Records persist across sessions until a Stop with no regression clears them.
`;

export const resolveCopilotPaths = (opts: HookInstallOpts): CopilotPaths => ({
	hookFile:
		opts.scope === "project"
			? path.join(opts.cwd, ".github", "hooks", "aislop.json")
			: path.join(
					process.env.COPILOT_HOME || path.join(opts.home, ".copilot"),
					"hooks",
					"aislop.json",
				),
	instructionsFile: path.join(opts.cwd, ".github", "copilot-instructions.md"),
});

const renderHookFile = (existing: string | null, qualityGate: boolean): string => {
	let config: Record<string, unknown> = {};
	if (existing) {
		try {
			config = JSON.parse(existing) as Record<string, unknown>;
		} catch {
			config = {};
		}
	}
	let next = upsertHookGroup(config, "PostToolUse", buildHookGroup());
	if (qualityGate) next = upsertHookGroup(next, "Stop", buildStopHookGroup());
	else next = removeAislopEntries(next, "Stop").next;
	return `${JSON.stringify(next, null, 2)}\n`;
};

export const installCopilot = (opts: HookInstallOpts): HookInstallResult => {
	const paths = resolveCopilotPaths(opts);
	const result = emptyResult();
	applyContent(
		result,
		opts,
		paths.hookFile,
		renderHookFile(readIfExists(paths.hookFile), Boolean(opts.qualityGate)),
		"register Copilot PostToolUse hook",
	);
	if (opts.scope === "project") {
		const fenced = upsertMarkdownFence(
			readIfExists(paths.instructionsFile),
			COPILOT_INSTRUCTIONS,
			sentinelHash(COPILOT_INSTRUCTIONS),
		);
		applyContent(
			result,
			opts,
			paths.instructionsFile,
			fenced.nextContent,
			"write Copilot instructions",
		);
	}
	return result;
};

export const uninstallCopilot = (
	opts: Omit<HookInstallOpts, "qualityGate">,
): HookUninstallResult => {
	const paths = resolveCopilotPaths({ ...opts, qualityGate: false });
	const result: HookUninstallResult = { removed: [], skipped: [] };
	const raw = readIfExists(paths.hookFile);
	if (raw != null) {
		try {
			const postToolUse = removeAislopEntries(
				JSON.parse(raw) as Record<string, unknown>,
				"PostToolUse",
			);
			const stop = removeAislopEntries(postToolUse.next, "Stop");
			if (postToolUse.removed + stop.removed === 0) {
				result.skipped.push(paths.hookFile);
			} else {
				applyRemoval(
					result,
					opts,
					paths.hookFile,
					Object.keys(stop.next).length === 0 ? null : `${JSON.stringify(stop.next, null, 2)}\n`,
				);
			}
		} catch {
			result.skipped.push(paths.hookFile);
		}
	} else result.skipped.push(paths.hookFile);
	if (opts.scope === "project") {
		const instructions = readIfExists(paths.instructionsFile);
		if (instructions == null) result.skipped.push(paths.instructionsFile);
		else {
			const next = removeMarkdownFence(instructions);
			if (next === instructions) {
				result.skipped.push(paths.instructionsFile);
			} else {
				applyRemoval(
					result,
					opts,
					paths.instructionsFile,
					next.trim().length === 0 ? null : `${next}\n`,
				);
			}
		}
	}
	return result;
};
