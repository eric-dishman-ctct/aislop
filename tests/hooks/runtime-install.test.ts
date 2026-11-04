import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/hooks/runtime/resolve.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/hooks/runtime/resolve.js")>();
	return {
		...actual,
		resolveHookRuntime: () => ({
			nodePath: process.execPath,
			cliPath: "/tmp/_npx/aislop/dist/cli.js",
			version: "test",
		}),
	};
});

const tempDirs: string[] = [];
const tempDir = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-runtime-install-"));
	tempDirs.push(dir);
	return dir;
};

afterEach(() => {
	vi.restoreAllMocks();
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("U1 temporary install guard", () => {
	it("install refusal: exits one and writes no runtime file", async () => {
		const { hookInstall } = await import("../../src/commands/hook.js");
		const home = tempDir();
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		vi.spyOn(os, "homedir").mockReturnValue(home);
		const priorExitCode = process.exitCode;
		process.exitCode = undefined;
		try {
			await hookInstall({
				agents: ["codex"],
				scope: "global",
				dryRun: false,
				yes: true,
				qualityGate: false,
			});
			expect(process.exitCode).toBe(1);
			expect(stderr).toHaveBeenCalledWith(expect.stringContaining("Install aislop stably"));
			expect(fs.existsSync(path.join(home, ".aislop", "hook-runtime.json"))).toBe(false);
		} finally {
			process.exitCode = priorExitCode;
		}
	});

	it("force flag: writes with a temporary warning", async () => {
		const { hookInstall } = await import("../../src/commands/hook.js");
		const home = tempDir();
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		vi.spyOn(os, "homedir").mockReturnValue(home);
		await hookInstall({
			agents: ["codex"],
			scope: "global",
			dryRun: false,
			yes: true,
			qualityGate: false,
			forceTemporary: true,
		});
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("temporary"));
		expect(fs.existsSync(path.join(home, ".aislop", "hook-runtime.json"))).toBe(true);
	});
});
