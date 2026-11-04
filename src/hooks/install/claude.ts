// aislop-ignore-file duplicate-block
import path from "node:path";
import { AISLOP_MD_BODY } from "../assets.js";
import type { ShellCommandBuilder } from "../runtime/command.js";
import { readIfExists } from "../io/atomic-write.js";
import { AISLOP_SENTINEL_KEY, removeAislopEntries, upsertHookGroup } from "../io/json-patch.js";
import { sentinelHash, upsertMarkdownFence } from "../io/sentinel.js";
import { buildHookCommand, commandBuilderFor } from "./command.js";
import {
	applyContent,
	applyRemoval,
	markPortableRewrite,
	emptyResult,
	type HookInstallOpts,
	type HookInstallResult,
	type HookUninstallResult,
} from "./types.js";

interface ClaudePaths {
	settings: string;
	aislopMd: string;
	claudeMd: string;
}

export const resolveClaudePaths = (opts: HookInstallOpts): ClaudePaths => {
	const root =
		opts.scope === "project" ? path.join(opts.cwd, ".claude") : path.join(opts.home, ".claude");
	return {
		settings: path.join(root, "settings.json"),
		aislopMd: path.join(root, "AISLOP.md"),
		claudeMd: path.join(root, "CLAUDE.md"),
	};
};

export const buildHookGroup = (builder: ShellCommandBuilder | null = null) => {
	const command = buildHookCommand(builder, "claude");
	const hashBody = JSON.stringify({ command, matcher: "Edit|Write|MultiEdit" });
	return {
		matcher: "Edit|Write|MultiEdit",
		hooks: [
			{
				type: "command",
				command,
				[AISLOP_SENTINEL_KEY]: { v: 1, managed: true, hash: sentinelHash(hashBody) },
			},
		],
	};
};

export const buildStopHookGroup = (builder: ShellCommandBuilder | null = null) => {
	const command = buildHookCommand(builder, "claude", ["--stop"]);
	const hashBody = JSON.stringify({ command });
	return {
		matcher: "",
		hooks: [
			{
				type: "command",
				command,
				[AISLOP_SENTINEL_KEY]: { v: 1, managed: true, hash: sentinelHash(hashBody) },
			},
		],
	};
};

// Files where a change outside the agent's edit cycle should refresh aislop's baseline.
// FileChanged matchers accept pipe-separated literal filenames only — no globs.
const FILE_CHANGED_MATCHER =
	".aislop/config.yml|.aislop/config.yaml|.aislop/rules.yml|.aislop/rules.yaml|package.json";

const buildFileChangedHookGroup = (builder: ShellCommandBuilder | null) => {
	const command = buildHookCommand(builder, "claude", ["--on-file-changed"]);
	const hashBody = JSON.stringify({ command, matcher: FILE_CHANGED_MATCHER });
	return {
		matcher: FILE_CHANGED_MATCHER,
		hooks: [
			{
				type: "command",
				command,
				[AISLOP_SENTINEL_KEY]: { v: 1, managed: true, hash: sentinelHash(hashBody) },
			},
		],
	};
};

const renderSettings = (
	existingRaw: string | null,
	qualityGate: boolean,
	builder: ShellCommandBuilder | null,
): string => {
	let obj: Record<string, unknown> = {};
	if (existingRaw) {
		try {
			obj = JSON.parse(existingRaw) as Record<string, unknown>;
		} catch {
			obj = {};
		}
	}
	let next = upsertHookGroup(obj, "PostToolUse", buildHookGroup(builder));
	next = upsertHookGroup(next, "FileChanged", buildFileChangedHookGroup(builder));
	if (qualityGate) next = upsertHookGroup(next, "Stop", buildStopHookGroup(builder));
	else next = removeAislopEntries(next, "Stop").next;
	return `${JSON.stringify(next, null, 2)}\n`;
};

export const installClaude = (opts: HookInstallOpts): HookInstallResult => {
	const paths = resolveClaudePaths(opts);
	const result = emptyResult();

	const existingSettings = readIfExists(paths.settings);
	const nextSettings = renderSettings(
		existingSettings,
		Boolean(opts.qualityGate),
		commandBuilderFor(opts),
	);
	markPortableRewrite(result, opts, existingSettings, [
		"aislop hook claude",
		"aislop hook claude --stop",
		"aislop hook claude --on-file-changed",
	]);
	applyContent(
		result,
		opts,
		paths.settings,
		nextSettings,
		"register PostToolUse + FileChanged hooks",
	);

	const mdHash = sentinelHash(AISLOP_MD_BODY);
	const existingMd = readIfExists(paths.aislopMd);
	const fenced = upsertMarkdownFence(existingMd, AISLOP_MD_BODY, mdHash);
	applyContent(result, opts, paths.aislopMd, fenced.nextContent, "write AISLOP.md rules");

	const existingClaudeMd = readIfExists(paths.claudeMd) ?? "";
	const marker = "@AISLOP.md";
	if (!existingClaudeMd.includes(marker)) {
		const joiner = existingClaudeMd.endsWith("\n") || existingClaudeMd.length === 0 ? "" : "\n";
		const prefix = existingClaudeMd.length === 0 ? "" : `${existingClaudeMd}${joiner}\n`;
		applyContent(
			result,
			opts,
			paths.claudeMd,
			`${prefix}${marker}\n`,
			"append @AISLOP.md reference",
		);
	} else {
		result.skipped.push(paths.claudeMd);
	}

	return result;
};

export const uninstallClaude = (
	opts: Omit<HookInstallOpts, "qualityGate">,
): HookUninstallResult => {
	const paths = resolveClaudePaths({ ...opts, qualityGate: false });
	const result: HookUninstallResult = { removed: [], skipped: [] };

	const settingsRaw = readIfExists(paths.settings);
	if (settingsRaw) {
		let obj: Record<string, unknown> = {};
		try {
			obj = JSON.parse(settingsRaw) as Record<string, unknown>;
		} catch {
			obj = {};
		}
		const afterPostToolUse = removeAislopEntries(obj, "PostToolUse").next;
		const afterFileChanged = removeAislopEntries(afterPostToolUse, "FileChanged").next;
		const stripped = removeAislopEntries(afterFileChanged, "Stop").next;
		const stillHasHooks =
			stripped.hooks &&
			typeof stripped.hooks === "object" &&
			Object.keys(stripped.hooks as object).length > 0;
		const otherKeys = Object.keys(stripped).filter((k) => k !== "hooks");
		if (!stillHasHooks && otherKeys.length === 0) {
			applyRemoval(result, opts, paths.settings, null);
		} else {
			applyRemoval(result, opts, paths.settings, `${JSON.stringify(stripped, null, 2)}\n`);
		}
	} else {
		result.skipped.push(paths.settings);
	}

	const existingMd = readIfExists(paths.aislopMd);
	if (existingMd?.includes("<!-- aislop:begin")) {
		applyRemoval(result, opts, paths.aislopMd, null);
	} else {
		result.skipped.push(paths.aislopMd);
	}

	const claudeMd = readIfExists(paths.claudeMd);
	if (claudeMd?.includes("@AISLOP.md")) {
		const stripped = claudeMd
			.split("\n")
			.filter((line) => line.trim() !== "@AISLOP.md")
			.join("\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
		applyRemoval(result, opts, paths.claudeMd, stripped.length === 0 ? null : `${stripped}\n`);
	} else {
		result.skipped.push(paths.claudeMd);
	}

	return result;
};
