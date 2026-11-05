import os from "node:os";
import { readPreferredHookRuntime } from "./runtime-file.js";
import { isTemporaryExecution, resolveHookRuntime } from "./resolve.js";

export const printHookRuntime = (json: boolean, cwd = process.cwd()): void => {
	const runtime = resolveHookRuntime();
	const preferred = readPreferredHookRuntime(cwd, os.homedir());
	const output = {
		...runtime,
		temporary: isTemporaryExecution(runtime.cliPath),
		source: preferred.source,
	};
	if (json) {
		process.stdout.write(`${JSON.stringify(output)}\n`);
		return;
	}
	process.stdout.write(
		`nodePath: ${output.nodePath}\ncliPath: ${output.cliPath}\nversion: ${output.version}\ntemporary: ${output.temporary}\nsource: ${output.source}\n`,
	);
};
