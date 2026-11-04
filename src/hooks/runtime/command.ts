export type ShellCommandBuilder = (nodePath: string, cliPath: string, args: string[]) => string;

const singleQuoted = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;
const powerShellSingleQuoted = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export const posixQuoted: ShellCommandBuilder = (nodePath, cliPath, args) =>
	[nodePath, cliPath, ...args].map(singleQuoted).join(" ");

export const powerShellQuoted: ShellCommandBuilder = (nodePath, cliPath, args) =>
	`& ${[nodePath, cliPath, ...args].map(powerShellSingleQuoted).join(" ")}`;

export const copilotExec = (
	nodePath: string,
	cliPath: string,
	args: string[],
): { exec: string; args: string[] } => ({ exec: nodePath, args: [cliPath, ...args] });

export const selectShellBuilder = (platform = process.platform): ShellCommandBuilder =>
	platform === "win32" ? powerShellQuoted : posixQuoted;
