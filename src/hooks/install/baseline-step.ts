import { baselinePath, captureBaseline, readBaseline } from "../quality-gate/baseline.js";

export interface HookBaselineResult {
	action: "captured" | "kept" | "planned";
	score?: number;
	path: string;
}

export const ensureHookBaseline = async (
	cwd: string,
	options: { dryRun: boolean },
): Promise<HookBaselineResult> => {
	if (options.dryRun) return { action: "planned", path: baselinePath(cwd) };
	const existing = readBaseline(cwd);
	if (existing) return { action: "kept", score: existing.score, path: baselinePath(cwd) };
	const captured = await captureBaseline(cwd);
	return { action: "captured", score: captured.score, path: captured.path };
};
