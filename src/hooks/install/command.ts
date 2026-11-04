import { selectShellBuilder, type ShellCommandBuilder } from "../runtime/command.js";
import { resolveHookRuntime } from "../runtime/resolve.js";
import type { HookInstallOpts } from "./types.js";

const portableCommand = (agent: string, flags: string[] = []): string =>
	["aislop", "hook", agent, ...flags].join(" ");

export const commandBuilderFor = (opts: HookInstallOpts): ShellCommandBuilder | null =>
	opts.absolute ? selectShellBuilder(opts.platform) : null;

export const buildHookCommand = (
	builder: ShellCommandBuilder | null,
	agent: string,
	flags: string[] = [],
): string => {
	if (!builder) return portableCommand(agent, flags);
	const runtime = resolveHookRuntime();
	return builder(runtime.nodePath, runtime.cliPath, ["hook", agent, ...flags]);
};
