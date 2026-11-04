import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const tempDir = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-runtime-built-"));
	tempDirs.push(dir);
	return dir;
};

const runtimeJson = (cli: string, args: string[] = []): { cliPath: string; source: string } => {
	const home = tempDir();
	return JSON.parse(
		execFileSync(process.execPath, [...args, cli, "hook", "runtime", "--json"], {
			encoding: "utf8",
			env: { ...process.env, HOME: home },
		}),
	);
};

afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("U1 built-CLI resolution", () => {
	it("built-CLI resolution: reports the canonical dist CLI path", () => {
		const cli = path.resolve("dist/cli.js");
		if (!fs.existsSync(cli)) execFileSync("pnpm", ["build"], { stdio: "inherit" });
		const runtime = runtimeJson(cli);
		expect(runtime.cliPath).toMatch(/dist[/\\]cli\.js$/);
		expect(runtime.cliPath).toBe(fs.realpathSync(cli));
		expect(runtime.source).toBe("none");
	});

	it("built-CLI resolution: resolves a symlink to its target", () => {
		const cli = path.resolve("dist/cli.js");
		if (!fs.existsSync(cli)) execFileSync("pnpm", ["build"], { stdio: "inherit" });
		const linkedCli = path.resolve("dist/aislop-runtime-link.js");
		fs.symlinkSync(cli, linkedCli);
		try {
			const runtime = runtimeJson(linkedCli, ["--preserve-symlinks-main"]);
			expect(linkedCli).not.toBe(cli);
			expect(runtime.cliPath).toBe(fs.realpathSync(cli));
			expect(runtime.cliPath).not.toBe(linkedCli);
		} finally {
			fs.unlinkSync(linkedCli);
		}
	});
});
