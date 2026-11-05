import os from "node:os";
import { resolveHookRuntime } from "./runtime/resolve.js";
import { readHookRuntime } from "./runtime/runtime-file.js";
import type { HookDoctorReport, HookDoctorRuntime, Scope } from "./doctor.js";

export const hookDoctorRuntime = (
	scope: Scope,
	home = os.homedir(),
	cwd = process.cwd(),
): HookDoctorRuntime => {
	const result = readHookRuntime(scope === "global" ? home : cwd);
	const current = resolveHookRuntime();
	const status =
		result.status === "ok" && result.runtime.version !== current.version ? "stale" : result.status;
	return {
		scope,
		status,
		pairMatchesCurrent:
			result.status === "ok" &&
			status === "ok" &&
			result.runtime.nodePath === current.nodePath &&
			result.runtime.cliPath === current.cliPath,
	};
};

export const renderHookDoctor = (report: HookDoctorReport, json: boolean): string => {
	if (json) return `${JSON.stringify(report)}\n`;
	const lines = ["Hook doctor", ""];
	for (const entry of report.entries)
		lines.push(
			`${entry.delivered ? "✓" : "✗"} ${entry.host} ${entry.scope} ${entry.eventGroup}: ${entry.commandForm}, started=${entry.started}, delivered=${entry.delivered}, timedOut=${entry.timedOut}`,
		);
	for (const runtime of report.runtime)
		lines.push(
			`${runtime.scope} runtime: ${runtime.status}, pair matches current=${runtime.pairMatchesCurrent}`,
		);
	for (const baseline of report.baseline) {
		if (baseline.status === "missing")
			lines.push(
				`${baseline.scope} baseline: missing, quality gate inactive, run aislop hook install --quality-gate or aislop hook baseline`,
			);
		else if (baseline.status === "ok")
			lines.push(`${baseline.scope} baseline: ok, score ${baseline.score}`);
		else lines.push(`${baseline.scope} baseline: not required`);
	}
	if (report.entries.length === 0) lines.push("No managed hooks found.");
	return `${lines.join("\n")}\n`;
};
