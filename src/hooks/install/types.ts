import fs from "node:fs";
import { atomicWrite, readIfExists } from "../io/atomic-write.js";

type HookScope = "global" | "project";

export interface HookInstallOpts {
	home: string;
	cwd: string;
	scope: HookScope;
	absolute: boolean;
	platform?: NodeJS.Platform;
	dryRun?: boolean;
	qualityGate?: boolean;
}

export interface HookInstallResult {
	wrote: string[];
	skipped: string[];
	planned: { path: string; summary: string }[];
	rewrittenFromPortable?: boolean;
}

export interface HookUninstallResult {
	removed: string[];
	skipped: string[];
}

export const emptyResult = (): HookInstallResult => ({
	wrote: [],
	skipped: [],
	planned: [],
});

export const markPortableRewrite = (
	result: HookInstallResult,
	opts: HookInstallOpts,
	existing: string | null,
	portableCommands: string[],
): void => {
	if (opts.scope !== "global" || !opts.absolute || opts.dryRun || existing == null) return;
	try {
		const containsPortableCommand = (value: unknown): boolean => {
			if (Array.isArray(value)) return value.some(containsPortableCommand);
			if (value == null || typeof value !== "object") return false;
			const entry = value as Record<string, unknown>;
			if (
				typeof entry.command === "string" &&
				portableCommands.includes(entry.command) &&
				typeof entry.__aislop === "object" &&
				entry.__aislop !== null &&
				(entry.__aislop as Record<string, unknown>).managed === true
			)
				return true;
			return Object.values(entry).some(containsPortableCommand);
		};
		if (containsPortableCommand(JSON.parse(existing))) result.rewrittenFromPortable = true;
	} catch {
		// The installer replaces invalid JSON without a portable rewrite report.
	}
};

export const applyContent = (
	result: HookInstallResult,
	opts: HookInstallOpts,
	target: string,
	nextContent: string,
	summary: string,
): void => {
	const existing = readIfExists(target);
	if (existing === nextContent) {
		result.skipped.push(target);
		return;
	}
	if (opts.dryRun) {
		result.planned.push({ path: target, summary });
		return;
	}
	atomicWrite(target, nextContent);
	result.wrote.push(target);
};

export const applyRemoval = (
	result: { removed: string[]; skipped: string[] },
	opts: { dryRun?: boolean },
	target: string,
	nextContent: string | null,
): void => {
	const existing = readIfExists(target);
	if (existing == null) {
		result.skipped.push(target);
		return;
	}
	if (existing === (nextContent ?? "")) {
		result.skipped.push(target);
		return;
	}
	if (opts.dryRun) {
		result.removed.push(target);
		return;
	}
	if (nextContent == null) {
		try {
			fs.unlinkSync(target);
		} catch {
			// best-effort
		}
	} else {
		atomicWrite(target, nextContent);
	}
	result.removed.push(target);
};
