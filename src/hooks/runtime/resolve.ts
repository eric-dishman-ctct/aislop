import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { APP_VERSION } from "../../version.js";

export interface HookRuntime {
	nodePath: string;
	cliPath: string;
	version: string;
}

export const resolveHookRuntime = (): HookRuntime => ({
	nodePath: fs.realpathSync(process.execPath),
	cliPath: fs.realpathSync(fileURLToPath(import.meta.url)),
	version: APP_VERSION,
});

export const isTemporaryExecution = (cliPath: string): boolean => {
	const normalized = cliPath.replace(/\\/g, "/");
	return (
		normalized.includes("/_npx/") ||
		normalized.includes("/.bun/install/cache/") ||
		/(?:^|\/)(?:pnpm|\.pnpm)\/(?:dlx)(?:\/|$)/.test(normalized) ||
		/(?:^|\/)\.yarn\/\$\$[^/]*(?:\/|$)/.test(normalized)
	);
};
