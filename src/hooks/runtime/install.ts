import { isTemporaryExecution, resolveHookRuntime } from "./resolve.js";
import { writeHookRuntime } from "./runtime-file.js";

export const allowHookRuntimeInstall = (dryRun: boolean, forceTemporary: boolean): boolean => {
	const runtime = resolveHookRuntime();
	if (dryRun || !isTemporaryExecution(runtime.cliPath)) return true;
	if (!forceTemporary) {
		process.stderr.write(
			"Refusing to install hooks from a temporary package cache. Install aislop stably, then run hook install again. Use --force-temporary to override.\n",
		);
		process.exitCode = 1;
		return false;
	}
	process.stderr.write("Warning: temporary execution will write durable hook runtime paths.\n");
	return true;
};

export const writeInstalledHookRuntimes = (scopes: Set<"global" | "project">): void => {
	for (const scope of scopes) writeHookRuntime(scope);
};
