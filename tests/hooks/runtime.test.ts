import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
	copilotExec,
	posixQuoted,
	powerShellQuoted,
	selectShellBuilder,
} from "../../src/hooks/runtime/command.js";
import { selfCommandPrefix } from "../../src/hooks/runtime/self-command.js";
import {
	readHookRuntime,
	readPreferredHookRuntime,
	writeHookRuntime,
} from "../../src/hooks/runtime/runtime-file.js";
import { isTemporaryExecution, resolveHookRuntime } from "../../src/hooks/runtime/resolve.js";

const tempDirs: string[] = [];
const tempDir = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-runtime-"));
	tempDirs.push(dir);
	return dir;
};

afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("U1 hook runtime", () => {
	it("resolver realpath: returns distinct canonical existing paths", () => {
		const runtime = resolveHookRuntime();
		expect(runtime.nodePath).toBe(fs.realpathSync(process.execPath));
		expect(runtime.nodePath).toBe(fs.realpathSync(runtime.nodePath));
		expect(runtime.cliPath).not.toBe(runtime.nodePath);
		expect(runtime.cliPath).toMatch(/resolve\.ts$/);
		expect(runtime.cliPath).toBe(fs.realpathSync(runtime.cliPath));
		expect(fs.existsSync(runtime.cliPath)).toBe(true);
	});

	it("temporary detection: detects cache paths and skips normal paths", () => {
		expect(isTemporaryExecution("/a/_npx/id/node_modules/aislop/dist/cli.js")).toBe(true);
		expect(isTemporaryExecution("/a/.bun/install/cache/pkg/cli.js")).toBe(true);
		expect(isTemporaryExecution("/a/pnpm/dlx/id/cli.js")).toBe(true);
		expect(isTemporaryExecution("/a/.yarn/$$virtual/pkg/cli.js")).toBe(true);
		expect(isTemporaryExecution("/usr/local/lib/node_modules/aislop/dist/cli.js")).toBe(false);
		expect(
			isTemporaryExecution("/home/x/.nvm/versions/node/v25.7.0/lib/node_modules/aislop/dist/cli.js"),
		).toBe(false);
		expect(
			isTemporaryExecution("/home/x/.local/share/pnpm/global/5/node_modules/aislop/dist/cli.js"),
		).toBe(false);
		expect(
			isTemporaryExecution("C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\aislop\\dist\\cli.js"),
		).toBe(false);
	});

	it("POSIX builder: preserves paths and arguments through sh", () => {
		const dir = path.join(tempDir(), "a b");
		fs.mkdirSync(dir);
		const nodePath = path.join(dir, "no'de");
		fs.writeFileSync(nodePath, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n", { mode: 0o755 });
		const cliPath = path.join(dir, 'c\\d $cli".js');
		const args = ["hook", "a b", "q'\"u"];
		const output = execFileSync("sh", ["-c", posixQuoted(nodePath, cliPath, args)], {
			encoding: "utf8",
		});
		expect(output.trimEnd().split("\n")).toEqual([cliPath, ...args]);
	});

	it("PowerShell builder: uses the call operator and doubles apostrophes", () => {
		expect(powerShellQuoted("C:\\a b\\node's.exe", "C:\\cli's.js", ["hook", "a'b"])).toBe(
			"& 'C:\\a b\\node''s.exe' 'C:\\cli''s.js' 'hook' 'a''b'",
		);
	});

	it("Copilot exec builder: returns shell-free node and cli arguments", () => {
		expect(copilotExec("/node", "/cli.js", ["hook", "claude"])).toEqual({
			exec: "/node",
			args: ["/cli.js", "hook", "claude"],
		});
	});

	it("builder selection: chooses PowerShell only on win32", () => {
		expect(selectShellBuilder("win32")).toBe(powerShellQuoted);
		expect(selectShellBuilder("darwin")).toBe(posixQuoted);
		expect(selectShellBuilder("linux")).toBe(posixQuoted);
	});

	it("U5 command form: uses the launch form that ran the hook", () => {
		expect(
			selfCommandPrefix({
				argv: ["node", "/opt/aislop/dist/cli.js"],
				execPath: "/opt/node/bin/node",
				platform: "linux",
			}),
		).toBe("'/opt/node/bin/node' '/opt/aislop/dist/cli.js'");
		expect(
			selfCommandPrefix({ argv: ["node", "/usr/local/bin/aislop"], execPath: "/node" }),
		).toBe("aislop");
		expect(selfCommandPrefix({ argv: ["node", "cli.js"], execPath: "/node" })).toBe("aislop");
		expect(
			selfCommandPrefix({
				argv: ["node", "C:\\Program Files\\aislop\\dist\\cli.js"],
				execPath: "C:\\Program Files\\nodejs\\node.exe",
				platform: "win32",
			}),
		).toBe("& 'C:\\Program Files\\nodejs\\node.exe' 'C:\\Program Files\\aislop\\dist\\cli.js'");
	});

	it("runtime file write: writes global and project schema-one files", () => {
		const home = tempDir();
		const cwd = tempDir();
		const globalPath = writeHookRuntime("global", { home, cwd });
		const projectPath = writeHookRuntime("project", { home, cwd });
		expect(globalPath).toBe(path.join(home, ".aislop", "hook-runtime.json"));
		expect(projectPath).toBe(path.join(cwd, ".aislop", "hook-runtime.json"));
		expect(JSON.parse(fs.readFileSync(globalPath, "utf8")).schema).toBe(1);
	});

	it("runtime file reader: prefers the project file over the global file", () => {
		const project = tempDir();
		const home = tempDir();
		const globalPath = writeHookRuntime("global", { home });
		const global = readPreferredHookRuntime(project, home);
		expect(global.status).toBe("ok");
		expect(global.path).toBe(globalPath);

		const projectPath = writeHookRuntime("project", { cwd: project });
		const preferred = readPreferredHookRuntime(project, home);
		expect(preferred.status).toBe("ok");
		expect(preferred.path).toBe(projectPath);

		fs.writeFileSync(
			projectPath,
			JSON.stringify({
				schema: 1,
				nodePath: "/missing-node",
				cliPath: "/missing-cli",
				version: "1",
				writtenAt: "now",
			}),
		);
		const staleProject = readPreferredHookRuntime(project, home);
		expect(staleProject.status).toBe("stale");
		expect(staleProject.path).toBe(projectPath);
	});

	it("runtime file read: returns missing, invalid, and stale without throwing", () => {
		const dir = tempDir();
		expect(readHookRuntime(dir).status).toBe("missing");
		fs.mkdirSync(path.join(dir, ".aislop"), { recursive: true });
		fs.writeFileSync(path.join(dir, ".aislop", "hook-runtime.json"), "not json");
		expect(readHookRuntime(dir).status).toBe("invalid");
		fs.writeFileSync(
			path.join(dir, ".aislop", "hook-runtime.json"),
			JSON.stringify({
				schema: 1,
				nodePath: "/missing-node",
				cliPath: "/missing-cli",
				version: "1",
				writtenAt: "now",
			}),
		);
		expect(readHookRuntime(dir).status).toBe("stale");
	});
});
