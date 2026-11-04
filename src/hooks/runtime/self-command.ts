import path from "node:path";
import { posixQuoted, powerShellQuoted } from "./command.js";

interface SelfCommandOptions {
	argv?: string[];
	execPath?: string;
	platform?: NodeJS.Platform;
}

export const selfCommandPrefix = ({
	argv = process.argv,
	execPath = process.execPath,
	platform = process.platform,
}: SelfCommandOptions = {}): string => {
	const cliPath = argv[1];
	const pathApi = platform === "win32" ? path.win32 : path;
	if (!cliPath || !pathApi.isAbsolute(cliPath) || pathApi.basename(cliPath) === "aislop") {
		return "aislop";
	}
	const quote = platform === "win32" ? powerShellQuoted : posixQuoted;
	return quote(execPath, cliPath, []);
};
